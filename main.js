const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog, MenuItem } = require('electron');
const path = require('path');
const nodemailer = require('nodemailer');
const si = require('systeminformation');
const { download } = require('electron-dl');
const fs = require('fs');
const os = require('os');
const { exec, spawn, execSync } = require('child_process');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { shell } = require('electron');
const https = require('https');
const { systemPreferences } = require('electron');
const { nativeImage } = require('electron');

// Import package.json to get version
const { version } = require('./package.json');

// Configure logging
log.transports.console.level = 'info';
log.transports.file.level = 'debug';
log.info('App starting...');

// Set up auto-updater logging
autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = false;

require('dotenv').config();

let mainWindow;
let tray = null;
let isRemoteSupportHandlerInitialized = false;
let isAppInitialized = false;
let isAppQuitting = false;

// Platform-specific configurations
const PLATFORM_CONFIG = {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux'
};

// Remote Support executable name in tools/dbs-utilities
const REMOTE_SUPPORT_EXE = 'dbs-tech-quickremotehelp.exe';

// Remote Support macOS installers in tools/dbs-utilities (per CPU architecture)
const REMOTE_SUPPORT_DMG = {
  x64: 'dbs-qs-mac-intel-chip-x64.dmg',
  arm64: 'dbs-qs-mac-m-chip-arm64.dmg'
};

/**
 * Open a file or folder using the system's default handler
 * @param {string} filePath Path to the file or folder
 * @returns {Promise<void>}
 */
function openFileOrFolder(filePath) {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to open: ${filePath}`);
    
    let command;
    if (PLATFORM_CONFIG.isWindows) {
      command = `start "" "${filePath}"`;
    } else if (PLATFORM_CONFIG.isMac) {
      command = `open "${filePath}"`;
    } else {
      command = `xdg-open "${filePath}"`;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error opening file: ${error}`);
        console.error(`stderr: ${stderr}`);
        reject(error);
      } else {
        console.log(`Successfully opened: ${filePath}`);
        resolve();
      }
    });
  });
}

/**
 * Helper function to promisify exec
 */
function execAsync(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout) => {
      if (error) {
        console.error(`Command failed: ${command}`);
        console.error(`Error: ${error}`);
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

// macOS Office detection: scan /Applications for Microsoft Office apps and read their versions
async function getOfficeInfoMac() {
  const officeApps = ['Microsoft Word', 'Microsoft Excel', 'Microsoft PowerPoint', 'Microsoft Outlook', 'Microsoft OneNote'];
  const products = [];
  for (const appName of officeApps) {
    const appPath = path.join('/Applications', `${appName}.app`);
    if (!fs.existsSync(appPath)) continue;
    const version = readPlistValue(path.join(appPath, 'Contents', 'Info.plist'), 'CFBundleShortVersionString') || 'Unknown';
    products.push({
      name: appName,
      version: `Version ${version}`,
      type: 'Microsoft Office for Mac',
      arch: '', license: '', registeredTo: '', channel: '', details: ''
    });
  }
  return products.length > 0
    ? { found: true, products, details: '' }
    : { found: false, details: 'No Microsoft Office applications found' };
}

// Comprehensive Office Info Helper
async function getOfficeInfo() {
  if (PLATFORM_CONFIG.isMac) return getOfficeInfoMac();
  if (!PLATFORM_CONFIG.isWindows) return { found: false, details: 'Not Windows' };
  const { execSync } = require('child_process');
  const fs = require('fs');
  let officeInfo = {
    found: false,
    products: [], // Multiple Office installs possible
    details: ''
  };

  // Helper: Map ProductReleaseIds to friendly names
  const productIdMap = {
    'O365ProPlusRetail': 'Microsoft 365 Apps for enterprise',
    'O365BusinessRetail': 'Microsoft 365 Apps for business',
    'O365HomePremRetail': 'Microsoft 365 Family',
    'O365EduCloud': 'Microsoft 365 Education',
    'ProfessionalRetail': 'Office Professional',
    'HomeStudentRetail': 'Office Home & Student',
    'HomeBusinessRetail': 'Office Home & Business',
    // Add more as needed
  };

  // Initialize WMI products array
  let wmiProducts = [];
  
  try {
    // 1. Try ClickToRun (Microsoft 365, modern Office)
    let clickToRunFound = false;
    try {
      const regBase = 'HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration';
      const prodIdsReg = execSync(`reg query "${regBase}" /v ProductReleaseIds`, { encoding: 'utf8' });
      const prodIdsMatch = prodIdsReg.match(/ProductReleaseIds\s+REG_SZ\s+(.+)/);
      if (prodIdsMatch) {
        clickToRunFound = true;
        let productIds = prodIdsMatch[1];
        let mainProductId = productIds.split(',')[0].replace(/;.*$/, '').trim();
        let officeName = productIdMap[mainProductId] || mainProductId;

        // Version/build
        let version = '', build = '', marketingVersion = '', versionDisplay = '';
        try {
          const versionReg = execSync(`reg query "${regBase}" /v VersionToReport`, { encoding: 'utf8' });
          const versionMatch = versionReg.match(/VersionToReport\s+REG_SZ\s+([\d\.]+)/);
          if (versionMatch) {
            version = versionMatch[1];
            // Example: 16.0.19029.20136
            const buildMatch = version.match(/^16\.0\.(\d+)\.(\d+)$/);
            if (buildMatch) {
              build = `${buildMatch[1]}.${buildMatch[2]}`;
              // Map build to YYMM (major version)
              // Microsoft uses a YYMM versioning (e.g. 2507)
              // See: https://learn.microsoft.com/en-us/officeupdates/update-history-microsoft365apps-by-date
              // We'll use the build's first 2 digits as YY, next 2 as MM (approx)
              const buildNum = parseInt(buildMatch[1], 10);
              // Heuristic: Microsoft increments build by ~100 for each month
              // We'll try to extract the YYMM from the build if possible
              // But fallback to just showing the build
              // (Best: use UpdateChannel info for exact version)
              marketingVersion = '';
              try {
                const clientVersionReg = execSync(`reg query "${regBase}" /v ClientVersionToReport`, { encoding: 'utf8' });
                const clientVersionMatch = clientVersionReg.match(/ClientVersionToReport\s+REG_SZ\s+([\d\.]+)/);
                if (clientVersionMatch) {
                  const clientVer = clientVersionMatch[1];
                  // Format: 2507
                  marketingVersion = clientVer;
                }
              } catch {}
              versionDisplay = marketingVersion
                ? `Version ${marketingVersion} (Build ${build} Click-to-Run)`
                : `Build ${build} (Click-to-Run)`;
            }
          }
        } catch {}

        // Channel
        let channel = '';
        try {
          const channelReg = execSync(`reg query "${regBase}" /v UpdateChannel`, { encoding: 'utf8' });
          const channelMatch = channelReg.match(/UpdateChannel\s+REG_SZ\s+(.+)/);
          if (channelMatch) {
            // Map known channel URLs to friendly names
            const url = channelMatch[1];
            if (url.match(/Current/)) channel = 'Current Channel';
            else if (url.match(/MonthlyEnterprise/)) channel = 'Monthly Enterprise Channel';
            else if (url.match(/Broad/)) channel = 'Semi-Annual Enterprise Channel';
            else channel = url;
          }
        } catch {}

        // Subscription email/account
        let registeredTo = '';
        try {
          const clickToRunUser = execSync(`reg query "HKCU\\Software\\Microsoft\\Office\\16.0\\Common\\CloudUser" /v AccountUpn`, { encoding: 'utf8' });
          const upnMatch = clickToRunUser.match(/AccountUpn\s+REG_SZ\s+(.+)/);
          if (upnMatch) registeredTo = upnMatch[1].trim();
        } catch {}
        // Try XML if not found
        if (!registeredTo) {
          const xmlDir = 'C:\\ProgramData\\Microsoft\\Office\\Account';
          try {
            if (fs.existsSync(xmlDir)) {
              const files = fs.readdirSync(xmlDir).filter(f => f.endsWith('.xml'));
              for (const file of files) {
                const xml = fs.readFileSync(`${xmlDir}\\${file}`, 'utf8');
                const upnXml = xml.match(/<UserPrincipalName>([^<]+)<\/UserPrincipalName>/);
                if (upnXml) {
                  registeredTo = upnXml[1];
                  break;
                }
              }
            }
          } catch {}
        }

        // Compose output
        officeInfo.products.push({
          name: officeName,
          version: versionDisplay,
          build: build,
          type: 'Office 365/ClickToRun',
          arch: '', // Optional: can add arch logic
          license: mainProductId,
          registeredTo: registeredTo ? `Subscription Product for ${registeredTo}` : '',
          channel: channel,
          details: ''
        });
        officeInfo.found = true;
      }
    } catch {}

    // 2. Fallback: Perpetual licenses (legacy Office)
    if (!officeInfo.found) {
      const regVersions = ['16.0','15.0','14.0','12.0'];
      for (const version of regVersions) {
        // Registration key
        const regKey = `HKLM\\SOFTWARE\\Microsoft\\Office\\${version}\\Registration`;
        try {
          const output = execSync(`reg query ${regKey} /s`, { encoding: 'utf8' });
          // Split by subkey
          const blocks = output.split(/\r?\n\r?\n/).filter(Boolean);
          for (const block of blocks) {
            let name = '', regOwner = '', prodId = '';
            const nameMatch = block.match(/ProductName\s+REG_SZ\s+(.+)/);
            if (nameMatch) name = nameMatch[1].trim();
            const ownerMatch = block.match(/RegisteredOwner\s+REG_SZ\s+(.+)/);
            if (ownerMatch) regOwner = ownerMatch[1].trim();
            const idMatch = block.match(/ProductID\s+REG_SZ\s+(.+)/);
            if (idMatch) prodId = idMatch[1].trim();
            if (name) {
              officeInfo.products.push({
                name,
                version,
                type: 'Perpetual',
                registeredTo: regOwner,
                license: prodId,
                details: ''
              });
            }
          }
        } catch {}
      }
    }

    // Clean up products array for reporting
    if (officeInfo.products.length > 0) {
      officeInfo.found = true;
    } else {
      officeInfo.details = 'Not detected';
    }

    // 3. Office 365/ClickToRun: Registry and XML
    try {
      const clickToRun = execSync(`reg query "HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration" /v ProductReleaseIds`, { encoding: 'utf8' });
      if (clickToRun && clickToRun.includes('ProductReleaseIds')) {
        let debugDetails = '';
        let marketingVersion = 'Unknown';
        let officeArch = 'Unknown';
        let officeName = 'Unknown';

        // Get version info
        try {
          const versionReg = execSync(`reg query "HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration" /v VersionToReport`, { encoding: 'utf8' });
          const versionMatch = versionReg.match(/VersionToReport\s+REG_SZ\s+([\d\.]+)/);
          if (versionMatch) {
            version = versionMatch[1];
            // Map build number to marketing version
            const buildMatch = version.match(/^16\.0\.(\d+)\./);
            if (buildMatch) {
              const build = parseInt(buildMatch[1], 10);
              if (build >= 17000) marketingVersion = '2024';
              else if (build >= 14000) marketingVersion = '2021';
              else if (build >= 10300) marketingVersion = '2019';
              else if (build >= 4266) marketingVersion = '2016';
              else marketingVersion = '16.x (Unknown)';
            }
          }
        } catch (e) { 
          debugDetails += 'No VersionToReport; '; 
        }

        // Get product IDs
        try {
          const prodIdsReg = execSync(`reg query "HKLM\\SOFTWARE\\Microsoft\\Office\\ClickToRun\\Configuration" /v ProductReleaseIds`, { encoding: 'utf8' });
          const prodIdsMatch = prodIdsReg.match(/ProductReleaseIds\s+REG_SZ\s+(.+)/);
          if (prodIdsMatch) {
            productIds = prodIdsMatch[1];
            officeName = productIds.split(',')[0].replace(/;.*$/, '');
          }
        } catch (e) { 
          debugDetails += 'No ProductReleaseIds; '; 
        }

        // Get registered user info
        let registeredTo = '';
        try {
          const clickToRunUser = execSync(`reg query "HKCU\\Software\\Microsoft\\Office\\16.0\\Common\\CloudUser" /v AccountUpn`, { encoding: 'utf8' });
          const upnMatch = clickToRunUser.match(/AccountUpn\s+REG_SZ\s+(.+)/);
          if (upnMatch) registeredTo = upnMatch[1].trim();
        } catch (e) { 
          debugDetails += 'No AccountUpn; '; 
        }

        // Try to get from XML if registry lookup failed
        if (!registeredTo) {
          const xmlDir = 'C:\\ProgramData\\Microsoft\\Office\\Account';
          try {
            if (fs.existsSync(xmlDir)) {
              const files = fs.readdirSync(xmlDir).filter(f => f.endsWith('.xml'));
              for (const file of files) {
                const xml = fs.readFileSync(path.join(xmlDir, file), 'utf8');
                const emailMatch = xml.match(/<UserEmail>([^<]+)<\/UserEmail>/i);
                if (emailMatch) {
                  registeredTo = emailMatch[1];
                  break;
                }
              }
            } else { 
              debugDetails += 'No Account XML dir; '; 
            }
          } catch (e) { 
            debugDetails += 'Account XML read error; '; 
          }
        }

        // Detect architecture
        try {
          const winword64 = 'C:\\Program Files\\Microsoft Office';
          const winword32 = 'C:\\Program Files (x86)\\Microsoft Office';
          if (fs.existsSync(winword64)) {
            const files = fs.readdirSync(winword64, { withFileTypes: true });
            if (files.some(f => f.name.toLowerCase() === 'root' || f.name.toLowerCase() === 'office16')) {
              officeArch = '64-bit';
            }
          }
          if (fs.existsSync(winword32)) {
            const files = fs.readdirSync(winword32, { withFileTypes: true });
            if (files.some(f => f.name.toLowerCase() === 'root' || f.name.toLowerCase() === 'office16')) {
              officeArch = '32-bit';
            }
          }
        } catch (e) { 
          debugDetails += 'Arch detect error; '; 
        }

        // Add product info
        officeInfo.products.push({
          name: officeName,
          version: marketingVersion,
          build: version,
          type: 'Office 365/ClickToRun',
          arch: officeArch,
          registeredTo: registeredTo || '',
          license: productIds,
          details: debugDetails || undefined
        });
      }
    } catch (err) {
      console.error('Error in ClickToRun detection:', err);
    }

    // 4. ospp.vbs script for license/account info
    // Try for Office16
    try {
      const osppPath = '"C:\\Program Files\\Microsoft Office\\Office16\\OSPP.VBS"';
      if (fs.existsSync('C:\\Program Files\\Microsoft Office\\Office16\\OSPP.VBS')) {
        const cscriptOut = execSync(`cscript //Nologo ${osppPath} /dstatus`, { encoding: 'utf8' });
        // Parse output for license/account info
        const blocks = cscriptOut.split(/\r?\n\r?\n/).filter(Boolean);
        for (const block of blocks) {
          let name = '', last5 = '', user = '', type = '', debugDetails = '';
          const nameMatch = block.match(/LICENSE NAME:\s+(.+)/i);
          if (nameMatch) name = nameMatch[1].trim();
          const last5Match = block.match(/Last 5 characters of installed product key: (\w+)/i);
          if (last5Match) last5 = last5Match[1];
          const userMatch = block.match(/Registered user:\s+(.+)/i);
          if (userMatch) user = userMatch[1].trim();
          // If Office 365 subscription
          if (/subscription/i.test(name)) type = 'Office 365/Subscription';
          if (name) {
            officeInfo.products.push({
              name,
              version: '',
              type: type || 'Perpetual',
              registeredTo: user || '',
              license: last5,
              details: debugDetails || undefined
            });
          }
        }
      }
    } catch {}

    // Aggregate all results
    const allProducts = [...wmiProducts, ...officeInfo.products];
    officeInfo.products = allProducts.filter((p, idx, arr) => {
      // Deduplicate by name+version+registeredTo
      return arr.findIndex(x => x.name === p.name && x.version === p.version && x.registeredTo === p.registeredTo) === idx;
    });
    officeInfo.found = officeInfo.products.length > 0;
    if (!officeInfo.found) officeInfo.details = 'Office not detected.';
  } catch (err) {
    officeInfo.details = `Error: ${err.message}`;
  }
  return officeInfo;
}
// Enhanced Antivirus Info Helper
async function getAntivirusInfo() {
  if (PLATFORM_CONFIG.isMac) {
    // macOS ships with XProtect/Gatekeeper built-in malware protection
    return {
      found: true,
      products: [{ name: 'macOS XProtect & Gatekeeper (built-in)', status: 'Enabled, UpToDate', lastUpdate: 'Managed by macOS' }]
    };
  }
  if (!PLATFORM_CONFIG.isWindows) return { found: false, details: 'Not Windows' };
  const { execSync } = require('child_process');
  let avProducts = [];
  try {
    // Use PowerShell to get detailed antivirus info
    const psCmd = `Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | Select-Object displayName,productState,pathToSignedProductExe,timestamp | ConvertTo-Json`;
    const output = execSync(`powershell -Command "${psCmd}"`, { encoding: 'utf8' });
    let parsed = [];
    try {
      parsed = JSON.parse(output);
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) parsed = [parsed];
    avProducts = parsed.map(p => {
      // Improved productState decode for Defender
      let status = 'Unknown';
      if (typeof p.productState === 'number' || (typeof p.productState === 'string' && p.productState.match(/^[0-9]+$/))) {
        const state = parseInt(p.productState);
        // See https://learn.microsoft.com/en-us/windows/win32/wmic/wmi-antivirusproduct-productstate
        // Bitmask: 0x10 = enabled, 0x1000 = up-to-date, 0x100 = scanning, 0x1 = snoozed
        const enabled = (state & 0x10) > 0;
        const upToDate = (state & 0x1000) > 0;
        const scanning = (state & 0x100) > 0;
        const snoozed = (state & 0x1) > 0;
        if (enabled && !snoozed) status = 'Enabled';
        else if (snoozed) status = 'Snoozed';
        else status = 'Disabled';
        status += upToDate ? ', UpToDate' : ', Outdated';
        if (scanning) status += ', Scanning';
      }
      return {
        name: p.displayName || '',
        status,
        exe: p.pathToSignedProductExe || '',
        lastUpdate: p.timestamp || '',
      };
    });
    // Fallback: if only Defender is present, and it's not reported as enabled, check Windows Security UI
    if (avProducts.length === 1 && avProducts[0].name.match(/Defender|Windows Defender|Microsoft Defender/i)) {
      try {
        // Use PowerShell to check Defender real-time protection
        const defStatus = execSync('powershell -Command "(Get-MpComputerStatus).RealTimeProtectionEnabled"', { encoding: 'utf8' });
        if (defStatus.trim().toLowerCase() === 'true') {
          avProducts[0].status = 'Enabled, UpToDate';
        }
      } catch {}
    }
    return { found: avProducts.length > 0, products: avProducts };
  } catch (err) {
    return { found: false, details: `Error: ${err.message}` };
  }
}

// Comprehensive System Information
ipcMain.handle('get-comprehensive-system-info', async () => {
  try {
    const [
      osInfo, 
      systemHealth, 
      securityScan
    ] = await Promise.all([
      si.osInfo(),
      analyzeSystemHealth(),
      performSecurityScan()
    ]);

    return {
      os: osInfo,
      health: systemHealth,
      security: securityScan,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Comprehensive system info error:', error);
    throw error;
  }
});

// Advanced System Health Monitoring
async function analyzeSystemHealth() {
  try {
    const [
      cpuInfo, 
      memInfo, 
      diskInfo, 
      networkInfo, 
      processesInfo,
      batteryInfo
    ] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.diskLayout(),
      si.networkInterfaces(),
      si.processes(),
      si.battery()
    ]);

    // Predictive Hardware Failure Detection
    const healthAnalysis = {
      cpu: {
        temperature: await si.cpuTemperature(),
        load: await si.currentLoad(),
        overheating: cpuInfo.temperature > 80 // Threshold for overheating
      },
      memory: {
        usage: memInfo.used / memInfo.total * 100,
        critical: memInfo.used / memInfo.total > 0.9 // Over 90% usage
      },
      storage: {
        health: diskInfo.map(disk => ({
          model: disk.model,
          freeSpace: disk.size - disk.used,
          lowSpace: (disk.size - disk.used) / disk.size < 0.1 // Less than 10% free
        }))
      },
      network: {
        interfaces: networkInfo.map(iface => ({
          name: iface.iface,
          speed: iface.speed,
          operational: iface.operstate === 'up'
        }))
      },
      performance: {
        runningProcesses: processesInfo.list.length,
        topCPUProcesses: processesInfo.list
          .sort((a, b) => b.cpu - a.cpu)
          .slice(0, 5)
      },
      battery: batteryInfo ? {
        percentage: batteryInfo.percent,
        charging: batteryInfo.isCharging,
        lowBattery: batteryInfo.percent < 20
      } : null
    };

    return healthAnalysis;
  } catch (error) {
    console.error('System health analysis error:', error);
    return null;
  }
}

// Security Scanning (Basic Implementation)
async function performSecurityScan() {
  if (PLATFORM_CONFIG.isMac) {
    // macOS: report built-in firewall and malware protection
    const firewallEnabled = (() => {
      try {
        const out = require('child_process').execSync('defaults read /Library/Preferences/com.apple.alf globalstate', { encoding: 'utf8' });
        return out.trim() !== '0';
      } catch { return false; }
    })();
    return {
      firewall: { enabled: firewallEnabled, profile: 'macOS Application Firewall' },
      antivirus: { installed: true, products: ['macOS XProtect & Gatekeeper (built-in)'] },
      risks: []
    };
  }
  try {
    const firewallStatus = await new Promise((resolve) => {
      exec('netsh advfirewall show currentprofile', (error, stdout) => {
        resolve({
          enabled: !error && stdout.includes('State                                 ON'),
          profile: stdout.match(/Current Profile:\s+(.+)/)?.[1] || 'Unknown'
        });
      });
    });

    const antivirusStatus = await new Promise((resolve) => {
      exec('wmic /namespace:\\\\root\\SecurityCenter2 path AntiVirusProduct get displayName', (error, stdout) => {
        resolve({
          installed: !error && stdout.trim().length > 0,
          products: stdout.trim().split('\n').filter(line => line.trim())
        });
      });
    });

    return {
      firewall: firewallStatus,
      antivirus: antivirusStatus,
      risks: [] // Placeholder for more advanced risk detection
    };
  } catch (error) {
    console.error('Security scan error:', error);
    return null;
  }
}

// Enhanced system information retrieval
ipcMain.handle('get-system-info', async () => {
  try {
    const { execSync } = require('child_process');
    const si = require('systeminformation');

    // Get comprehensive system information
    const [
      osInfo,
      cpuInfo,
      memInfo,
      diskInfo,
      networkInfo,
      graphicsInfo,
      batteryInfo,
      systemUptime,
      systemInfo
    ] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces(),
      si.graphics(),
      si.battery(),
      si.time(),
      si.system()
    ]);

    // Get Office and Antivirus Info
    const [officeInfo, antivirusInfo] = await Promise.all([
      getOfficeInfo(),
      getAntivirusInfo()
    ]);

    // Format system information
    return {
      // System Details
      system: {
        manufacturer: systemInfo.manufacturer,
        model: systemInfo.model,
        serial: systemInfo.serial,
        uuid: systemInfo.uuid
      },
      
      // OS Details
      platform: `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`,
      hostname: os.hostname(),
      username: process.env['USERNAME'] || process.env['USER'] || 'Unknown',
      domainType: (() => {
        try {
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            // wmic is removed on newer Windows 11 builds - use PowerShell CIM instead
            const output = execSync('powershell.exe -Command "Get-CimInstance Win32_ComputerSystem | Select-Object Domain,DomainRole | ConvertTo-Json"', { encoding: 'utf8' });
            const parsed = JSON.parse(output);
            const domain = (parsed.Domain || '').trim();
            const role = String(parsed.DomainRole);
            if (domain) {
              if (["0","1","2"].includes(role)) return { type: 'Workgroup', name: domain };
              if (["3","4"].includes(role)) return { type: 'Domain', name: domain };
              return { type: 'Unknown', name: domain };
            }
          } else if (PLATFORM_CONFIG.isMac) {
            // Detect Active Directory binding on macOS (best effort)
            try {
              const { execSync } = require('child_process');
              const adOutput = execSync('dsconfigad -show', { encoding: 'utf8' });
              if (adOutput && adOutput.includes('Active Directory Domain')) {
                const domainMatch = adOutput.match(/Active Directory Domain\s*=\s*(.+)/);
                return { type: 'Domain', name: domainMatch ? domainMatch[1].trim() : 'Active Directory' };
              }
            } catch {}
            return { type: 'Standalone', name: os.hostname() };
          }
        } catch (e) {}
        return { type: 'Unknown', name: '' };
      })(),

      // Office and Antivirus Details
      office: officeInfo,
      antivirus: antivirusInfo,
      
      // Uptime
      uptime: `${Math.floor(systemUptime.uptime / 3600)} hours, ${Math.floor((systemUptime.uptime % 3600) / 60)} minutes`,
      
      // CPU Details
      cpu: await (async () => {
        try {
          const [cpuInfo, cpuLoad] = await Promise.all([
            si.cpu(),
            si.currentLoad()
          ]);

          return {
            model: cpuInfo.brand,
            cores: cpuInfo.cores,
            currentLoad: cpuLoad ? cpuLoad.currentLoad : 0
          };
        } catch (error) {
          console.error('CPU information retrieval error:', error);
          return {
            model: 'Unknown',
            cores: 'N/A',
            currentLoad: 0
          };
        }
      })(),
      
      // Memory Details
      memory: {
        total: memInfo.total,
        used: memInfo.used,
        free: memInfo.free,
        usagePercent: ((memInfo.used / memInfo.total) * 100)
      },
      
      // Disk Details
      disks: await (async () => {
  try {
    const [diskInfo, diskLayout, blockDevices] = await Promise.all([
      si.fsSize().catch(() => []),
      si.diskLayout().catch(() => []),
      si.blockDevices().catch(() => [])
    ]);

    // Get detailed disk info from PowerShell (Windows only)
    let detailedDisks = [];
    if (process.platform === 'win32') {
      try {
        const powerShellCommand = `Get-PhysicalDisk | Select-Object DeviceID, MediaType, BusType, FriendlyName, Size, HealthStatus, OperationalStatus | ConvertTo-Json`;
        const result = execSync(`powershell.exe -Command "${powerShellCommand}"`, { encoding: 'utf-8' });
        detailedDisks = JSON.parse(result);
        if (!Array.isArray(detailedDisks)) {
          detailedDisks = [detailedDisks];
        }
      } catch (error) {
        console.error('Error getting detailed disk info from PowerShell:', error);
      }
    }

    return diskInfo.map(disk => {
      try {
        if (!disk || !disk.mount) return null;

        // Find matching disk in layout by size (within 1%)
        const matchedDisk = diskLayout.find(d => 
          d.size && disk.size && Math.abs(d.size - disk.size) / disk.size < 0.01
        );

        // Get detailed disk info from PowerShell
        const detailedDisk = detailedDisks.find(d => 
          d.Size && disk.size && Math.abs(d.Size - disk.size) / disk.size < 0.01
        ) || {};

        // Determine disk type with fallbacks
        let diskType = 'Unknown';
        if (detailedDisk.MediaType) {
          diskType = detailedDisk.MediaType;
        } else if (matchedDisk && matchedDisk.type) {
          diskType = matchedDisk.type;
        }
        if (detailedDisk.BusType === 'NVMe' || (matchedDisk && matchedDisk.interfaceType === 'NVMe')) {
          diskType = 'NVMe SSD';
        }

        // Get make and model
        const make = (detailedDisk.FriendlyName ? detailedDisk.FriendlyName.split(' ')[0] : '') || 
                    (matchedDisk && matchedDisk.vendor) || 
                    'Unknown';
        
        const model = (detailedDisk.FriendlyName || '').replace(make, '').trim() || 
                     (matchedDisk && matchedDisk.name) || 
                     'Unknown';

        return {
          mount: disk.mount,
          type: diskType,
          fs: disk.fs || 'Unknown FS',
          total: disk.size,
          used: disk.used,
          free: disk.available,
          usagePercent: disk.use || 0,
          model: model,
          vendor: make,
          serial: (matchedDisk && matchedDisk.serialNum) || 'Unknown'
        };
      } catch (error) {
        console.error('Error processing disk:', error, disk);
        return null;
      }
    }).filter(Boolean);
  } catch (error) {
    console.error('Disk information retrieval error:', error);
    return [];
  }
})(),
      
      // Network Details
      network: await (async () => {
        try {
          const { execSync } = require('child_process');
          
          // Retrieve information using multiple methods
          const [
            networkInterfaces, 
            networkStats
          ] = await Promise.all([
            si.networkInterfaces(),
            si.networkStats()
          ]);

          // Get detailed network adapter information using PowerShell (Windows)
          let detailedAdapters = [];
          if (process.platform === 'win32') {
            try {
              const psCommand = `Get-NetAdapter | Select-Object Name, InterfaceDescription, Status, MacAddress, LinkSpeed, InterfaceIndex, ifIndex, ifType, InterfaceAlias, InterfaceOperationalStatus, MediaType, PhysicalMediaType, DriverInformation, DriverVersion, DriverDate | ConvertTo-Json`;
              const result = execSync(`powershell -Command "${psCommand}"`, { encoding: 'utf8' });
              if (result) {
                detailedAdapters = JSON.parse(result);
                if (!Array.isArray(detailedAdapters)) {
                  detailedAdapters = [detailedAdapters];
                }
              }
            } catch (e) {
              console.log('PowerShell network adapter info failed, using basic info');
            }
          }

          // Get IP configuration for all adapters
          const getIPConfig = async (iface) => {
            try {
              const ip4 = iface.ip4 || '';
              const ip6 = iface.ip6 || '';
              const subnet = iface.cidr || '';
              const mac = iface.mac || '';
              
              // Try to get gateway and DNS
              let gateway = 'N/A';
              let dnsServers = [];
              
              if (process.platform === 'win32') {
                try {
                  // Get default gateway
                  const routeCmd = `route print 0.0.0.0 | findstr /r /c:"^ *0.0.0.0"`;
                  const routeOutput = execSync(routeCmd, { encoding: 'utf8' });
                  const gatewayMatch = routeOutput.match(/0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/);
                  if (gatewayMatch) {
                    gateway = gatewayMatch[1];
                  }
                  
                  // Get DNS servers
                  const dnsCmd = `ipconfig /all | findstr /i "DNS Servers"`;
                  const dnsOutput = execSync(dnsCmd, { encoding: 'utf8' });
                  dnsServers = dnsOutput.split('\n')
                    .map(line => line.match(/\d+\.\d+\.\d+\.\d+/))
                    .filter(match => match)
                    .map(match => match[0]);
                } catch (e) {
                  console.error('Error getting network details:', e);
                }
              }
              
              return { ip4, ip6, subnet, mac, gateway, dnsServers };
            } catch (error) {
              console.error('Error in getIPConfig:', error);
              return { ip4: 'N/A', ip6: 'N/A', subnet: 'N/A', mac: 'N/A', gateway: 'N/A', dnsServers: [] };
            }
          };
          
          // Get WiFi network name if applicable
          const getWifiNetworkName = async (iface) => {
            if (iface.type !== 'wireless') return 'N/A';
            
            try {
              if (process.platform === 'win32') {
                const wifiCmd = 'netsh wlan show interfaces';
                const wifiOutput = execSync(wifiCmd, { encoding: 'utf8' });
                const ssidMatch = wifiOutput.match(/SSID\s*:\s*([^\r\n]+)/i);
                return ssidMatch ? ssidMatch[1].trim() : 'Not connected';
              }
              return 'N/A';
            } catch (e) {
              return 'Error retrieving SSID';
            }
          };

          // Process all network interfaces
          const allInterfaces = await Promise.all(networkInterfaces.map(async (iface) => {
            const stats = networkStats.find(stat => stat.iface === iface.iface) || {};
            const ipConfig = await getIPConfig(iface);
            const wifiNetworkName = await getWifiNetworkName(iface);
            
            // Find detailed adapter info
            const detailedInfo = detailedAdapters.find(adapter => 
              adapter.InterfaceIndex === iface.iface ||
              adapter.InterfaceAlias === iface.ifaceName ||
              adapter.Name === iface.ifaceName
            ) || {};
            
            // Determine connection status
            let status = 'Disconnected';
            if (iface.operstate === 'up') status = 'Connected';
            else if (iface.operstate === 'down') status = 'Disabled';
            
            // Get connection type
            let connectionType = iface.type || 'Unknown';
            // Detect Bluetooth PAN adapters
            if ((iface.ifaceName && iface.ifaceName.toLowerCase().includes('bluetooth')) ||
                (detailedInfo.InterfaceDescription && detailedInfo.InterfaceDescription.toLowerCase().includes('bluetooth')) ||
                (iface.name && iface.name.toLowerCase().includes('bluetooth')) ||
                (iface.description && iface.description.toLowerCase().includes('bluetooth'))
            ) {
              connectionType = 'Bluetooth';
            } else if (detailedInfo.InterfaceDescription) {
              if (detailedInfo.InterfaceDescription.includes('Wireless')) connectionType = 'Wireless';
              else if (detailedInfo.InterfaceDescription.includes('Ethernet')) connectionType = 'Ethernet';
              else if (detailedInfo.InterfaceDescription.includes('Virtual')) connectionType = 'Virtual';
            }
            
            return {
              name: iface.ifaceName || iface.iface || 'Unknown',
              description: detailedInfo.InterfaceDescription || iface.iface,
              type: connectionType,
              status: status,
              mac: iface.mac || '00:00:00:00:00:00',
              ip4: ipConfig.ip4,
              ip6: ipConfig.ip6,
              subnet: ipConfig.subnet,
              gateway: ipConfig.gateway,
              dnsServers: ipConfig.dnsServers,
              wifiNetwork: wifiNetworkName,
              speed: iface.speed || detailedInfo.LinkSpeed || 'N/A',
              isVirtual: iface.virtual || connectionType === 'Virtual',
              driver: {
                name: detailedInfo.DriverInformation || 'Unknown',
                version: detailedInfo.DriverVersion || 'Unknown',
                date: detailedInfo.DriverDate || 'Unknown'
              },
              stats: {
                rx_bytes: stats.rx_bytes || 0,
                tx_bytes: stats.tx_bytes || 0,
                rx_sec: stats.rx_sec || 0,
                tx_sec: stats.tx_sec || 0,
                ms: stats.ms || 0
              }
            };
          }));
          
          return { adapters: allInterfaces };
          
        } catch (error) {
          console.error('Network information retrieval error:', error);
          return { 
            adapters: [{
              name: 'Network Detection Failed',
              error: error.message || 'Unknown error'
            }] 
          };
        }
      })(),
      
      // Graphics Details
      graphics: graphicsInfo.controllers.map(gpu => ({
        vendor: gpu.vendor,
        model: gpu.model,
        vram: (gpu.vram / (1024 * 1024)).toFixed(2) + ' MB'
      })),
      
      // Battery and Power Information
      battery: await (async () => {
        try {
          const batteryInfo = await si.battery();
          
          // Power Plan retrieval (Windows: active scheme; macOS: current power source)
          let powerPlan = 'Unknown';
          try {
            const { execSync } = require('child_process');
            if (PLATFORM_CONFIG.isWindows) {
              const powerPlanOutput = execSync('powercfg /getactivescheme', { encoding: 'utf8' });
              const planMatch = powerPlanOutput.match(/Power Scheme GUID: .*\((.*)\)/);
              powerPlan = planMatch ? planMatch[1] : 'Unknown';
            } else if (PLATFORM_CONFIG.isMac) {
              const pmsetOutput = execSync('pmset -g batt', { encoding: 'utf8' });
              const sourceMatch = pmsetOutput.match(/'([^']+)'/);
              powerPlan = sourceMatch ? sourceMatch[1] : 'Unknown';
            }
          } catch (powerPlanError) {
            console.error('Power plan retrieval error:', powerPlanError);
          }

          return {
            percentage: batteryInfo.percent !== -1 ? `${batteryInfo.percent}%` : 'N/A',
            charging: batteryInfo.isCharging,
            powerPlan: powerPlan
          };
        } catch (error) {
          console.error('Battery information retrieval error:', error);
          return {
            percentage: 'N/A',
            charging: 'Unknown',
            powerPlan: 'Unknown'
          };
        }
      })(),
      
      // Additional System Information
      additionalInfo: await (async () => {
        try {
          const { execSync } = require('child_process');
          
          // Retrieve information using multiple methods
          const [
            biosInfo, 
            temperatureInfo, 
            displayInfo
          ] = await Promise.all([
            si.bios(),
            si.cpuTemperature(),
            si.graphics()
          ]);

          // Prepare additional information object
          const additionalInfo = {};

          // BIOS Information
          if (biosInfo.vendor || biosInfo.version || biosInfo.releaseDate) {
            additionalInfo.bios = {
              vendor: biosInfo.vendor || 'N/A',
              version: biosInfo.version || 'N/A',
              releaseDate: biosInfo.releaseDate || 'N/A'
            };
          }

          // Temperature Information
          if (temperatureInfo.main !== -1 || 
              (temperatureInfo.cores && temperatureInfo.cores.length > 0)) {
            additionalInfo.temperatures = {
              cpu: (typeof temperatureInfo.main === 'number' && isFinite(temperatureInfo.main))
                ? `${temperatureInfo.main.toFixed(1)}°C`
                : 'N/A',
              cores: Array.isArray(temperatureInfo.cores) && temperatureInfo.cores.length > 0
                ? temperatureInfo.cores.map(core => (typeof core === 'number' && isFinite(core) ? `${core.toFixed(1)}°C` : 'N/A')).join(', ')
                : 'N/A'
            };
          }

          // Display Information
          const validDisplays = displayInfo.displays.filter(display => 
            display.model || display.resolutionX || display.resolutionY
          );
          if (validDisplays.length > 0) {
            additionalInfo.display = validDisplays.map(display => ({
              model: display.model || 'Unknown',
              main: display.main,
              resolution: `${display.resolutionX}x${display.resolutionY}`,
              pixelDepth: display.pixelDepth
            }));
          }

          return additionalInfo;
        } catch (error) {
          console.error('Additional system information retrieval error:', error);
          return {};
        }
      })(),
    };
  } catch (error) {
    console.error('Error retrieving system information:', error);
    return null;
  }
});

// IPC handler to get the app version
ipcMain.handle('get-app-version', () => {
  const version = app.getVersion();
  log.info(`Sending app version to renderer: ${version}`);
  return version;
});

// Ticket Submission Handler
ipcMain.handle('send-ticket', async (event, ticketData) => {
    console.log(`[send-ticket handler] Invoked at ${new Date().toISOString()}`);
    try {
        // Prepare email content (plain text)
        const remoteSupportText = ticketData.remoteSupport
            ? `\nRemote Support Session:\n  ID: ${ticketData.remoteSupport.id}\n  Password: ${ticketData.remoteSupport.password}\n`
            : '';
        const emailContent = `Support Ticket Details:\n\nSubject: ${ticketData.subject || 'No Subject'}\nFull Name: ${ticketData.fullName}\nCompany Name: ${ticketData.companyName || 'Not Provided'}\nProvince: ${ticketData.province || 'Not Provided'}\nEmail: ${ticketData.email}\nPhone: ${ticketData.phone}\n${remoteSupportText}\nDescription:\n${ticketData.description}\n\nSystem Information:\n${JSON.stringify(ticketData.systemInfo, null, 2)}\n`;

        // Prepare email content (HTML)
        function systemInfoTable(systemInfo) {
            if (!systemInfo) return '<em>No system info available</em>';
            let html = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;width:100%;margin-top:8px;">';
            function row(label, value) {
                return `<tr><td style=\"background:#f4f4f4;font-weight:bold;\">${label}</td><td>${value}</td></tr>`;
            }
            
            // Add system information at the top
            if (systemInfo.system) {
                html += row('System Manufacturer', systemInfo.system.manufacturer || 'N/A');
                html += row('System Model', systemInfo.system.model || 'N/A');
                html += row('System Serial', systemInfo.system.serial || 'N/A');
            }
            if (systemInfo.platform) {
                html += row('Platform', systemInfo.platform);
            }
            if (systemInfo.office && systemInfo.office.products && systemInfo.office.products.length > 0) {
                const officeStr = '<ul>' + systemInfo.office.products.map(o => {
                    let parts = [];
                    if (o.name) parts.push(o.name);
                    if (o.version && o.version !== 'Unknown') parts.push(`Version: ${o.version}`);
                    if (o.build && o.build !== o.version && o.build !== 'Unknown') parts.push(`Build: ${o.build}`);
                    if (o.type && o.type !== 'Unknown') parts.push(o.type);
                    if (o.arch && o.arch !== 'Unknown') parts.push(o.arch);
                    if (o.license && o.license !== 'Unknown') parts.push(`License: ${o.license}`);
                    if (o.registeredTo && o.registeredTo !== 'Unknown') parts.push(`Registered To: ${o.registeredTo}`);
                    if (o.channel && o.channel.startsWith('http')) {
                        // Try to extract channel name from URL if possible
                        const channelMatch = o.channel.match(/\/([\w\-]+)$/);
                        if (channelMatch) parts.push(`Channel: ${channelMatch[1]}`);
                    } else if (o.channel && o.channel !== 'Unknown') {
                        parts.push(`Channel: ${o.channel}`);
                    }
                    if (o.details && o.details !== 'Unknown') parts.push(o.details);
                    return `<li>${parts.join(', ')}</li>`;
                }).join('') + '</ul>';
                html += row('Office', officeStr);
            }
            if (systemInfo.antivirus && systemInfo.antivirus.products && systemInfo.antivirus.products.length > 0) {
                const avStr = '<ul>' + systemInfo.antivirus.products.map(av => {
                    let s = `${av.name} (${av.status})`;
                    if (av.lastUpdate) s += `, Last Update: ${av.lastUpdate}`;
                    return `<li>${s}</li>`;
                }).join('') + '</ul>';
                html += row('Antivirus', avStr);
            } else if (systemInfo.antivirus) {
                html += row('Antivirus', `<span style='color:#888'>${systemInfo.antivirus.details || 'Not detected'}</span>`);
            }
            if (systemInfo.hostname) {
                html += row('Hostname', systemInfo.hostname || '');
            }
            if (systemInfo.username) {
                html += row('Windows User', systemInfo.username);
            }
            if (systemInfo.domainType && systemInfo.domainType.type && systemInfo.domainType.type !== 'Unknown') {
                let domStr = systemInfo.domainType.type;
                if (systemInfo.domainType.name) domStr += `: ${systemInfo.domainType.name}`;
                html += row('Domain/Workgroup', domStr);
            }
            if (systemInfo.uptime) {
                html += row('Uptime', systemInfo.uptime || '');
            }
            if (systemInfo.cpu) {
                html += row('CPU', `${systemInfo.cpu.model || ''} (${systemInfo.cpu.cores || ''} cores)`);
                html += row('CPU Load', systemInfo.cpu.currentLoad ? systemInfo.cpu.currentLoad.toFixed(1) + '%' : 'N/A');
            }
            if (systemInfo.memory) {
                html += row('Memory', `${(systemInfo.memory.used/1024/1024/1024).toFixed(2)} GB used / ${(systemInfo.memory.total/1024/1024/1024).toFixed(2)} GB total (${systemInfo.memory.usagePercent ? systemInfo.memory.usagePercent.toFixed(1) : '?'}%)`);
            }
            if (systemInfo.disks && Array.isArray(systemInfo.disks) && systemInfo.disks.length > 0) {
                html += `<tr><td style="background:#f4f4f4;font-weight:bold;">Disks</td><td><ul style="margin:0;padding-left:15px;">` +
                    systemInfo.disks.map(d => {
                        try {
                            // Format sizes
                            const totalGB = (d.total / (1024 * 1024 * 1024)).toFixed(2);
                            const usedGB = (d.used / (1024 * 1024 * 1024)).toFixed(2);
                            const usagePercent = d.usagePercent ? d.usagePercent.toFixed(1) : '0.0';
                            
                            // Build disk info string
                            const parts = [
                                `<strong>${d.mount}</strong>`,
                                d.model !== 'Unknown Model' ? d.model : '',
                                d.type ? `(${d.type})` : '',
                                `[${d.fs}]`,
                                `- ${usedGB}GB used of ${totalGB}GB (${usagePercent}%)`,
                                d.vendor !== 'Unknown' ? `- Vendor: ${d.vendor}` : '',
                                d.serial !== 'Unknown' ? `- S/N: ${d.serial}` : ''
                            ].filter(Boolean);
                            
                            return `<li>${parts.join(' ')}</li>`;
                        } catch (error) {
                            console.error('Error formatting disk info:', error, d);
                            return `<li>Error displaying disk information</li>`;
                        }
                    }).join('') +
                    `</ul></td></tr>`;
            }

            if (systemInfo.network && systemInfo.network.adapters && Array.isArray(systemInfo.network.adapters)) {
                html += `<tr><td style="background:#f4f4f4;font-weight:bold;">Network</td><td><ul style="margin:0;padding-left:15px;">` +
                    systemInfo.network.adapters.map(a => {
                        // Format connection status
                        let status = 'Disconnected';
// ... (rest of the code remains the same)
                        if (a.status === 'Connected') status = 'Connected';
                        else if (a.operstate === 'up') status = 'Connected';
                        else if (a.operstate === 'down') status = 'Disabled';
                        
                        // Format connection type
                        const type = a.type ? a.type.charAt(0).toUpperCase() + a.type.slice(1).toLowerCase() : 'Unknown';
                        
                        // Get WiFi network name if connected to WiFi
                        let wifiInfo = '';
                        if (type.toLowerCase() === 'wireless' || type.toLowerCase() === 'wifi') {
                            wifiInfo = `, WiFi: ${a.wifiNetwork || a.wifiNetworkName || 'Not connected'}`;
                        }
                        
                        // Format IP address (prefer IPv4, fall back to IPv6)
                        const ipAddress = a.ip4 || a.ip6 || a.ip || 'N/A';
                        
                        // Format MAC address
                        const macAddress = a.mac || 'N/A';
                        
                        // Format the display line
                        return `<li>${a.name || 'Unknown Adapter'} (${type}) - IP: ${ipAddress}, MAC: ${macAddress}${wifiInfo}, Status: ${status}</li>`;
                    }).join('') +
                    `</ul></td></tr>`;
            }
            if (systemInfo.graphics && Array.isArray(systemInfo.graphics)) {
                html += `<tr><td style="background:#f4f4f4;font-weight:bold;">Graphics</td><td><ul style="margin:0;padding-left:15px;">` +
                    systemInfo.graphics.map(g => `<li>${g.vendor || ''} ${g.model || ''} (${g.vram || ''})</li>`).join('') +
                    `</ul></td></tr>`;
            }
            if (systemInfo.battery) {
                html += row('Battery', `Charge: ${systemInfo.battery.percentage || 'N/A'}, Charging: ${systemInfo.battery.charging ? 'Yes' : 'No'}, Power Plan: ${systemInfo.battery.powerPlan || 'N/A'}`);
            }
            if (systemInfo.additionalInfo && systemInfo.additionalInfo.bios) {
                html += row('BIOS', `${systemInfo.additionalInfo.bios.vendor || ''} v${systemInfo.additionalInfo.bios.version || ''} (${systemInfo.additionalInfo.bios.releaseDate || ''})`);
            }

            if (systemInfo.additionalInfo && systemInfo.additionalInfo.display && Array.isArray(systemInfo.additionalInfo.display)) {
                html += `<tr><td style="background:#f4f4f4;font-weight:bold;">Displays</td><td><ul style="margin:0;padding-left:15px;">` +
                    systemInfo.additionalInfo.display.map(d => `<li>${d.model || 'Unknown'} ${d.main ? '(Main)' : ''} - ${d.resolution || ''}, Depth: ${d.pixelDepth || ''}</li>`).join('') +
                    `</ul></td></tr>`;
            }
            html += '</table>';
            return html;
        }

        const remoteSupportHtml = ticketData.remoteSupport
            ? `<div style="background:#e8f5e9;padding:12px;border-radius:6px;margin-bottom:18px;border-left:4px solid #2ecc71;">
                    <h3 style="margin:0 0 10px 0;color:#2c3e50;">Remote Support Session:</h3>
                    <table cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-size:15px;">
                        <tr><td style="font-weight:bold;width:120px;">Support ID:</td><td>${ticketData.remoteSupport.id}</td></tr>
                        <tr><td style="font-weight:bold;">Password:</td><td>${ticketData.remoteSupport.password}</td></tr>
                    </table>
                </div>`
            : '';

        const emailHtml = `
            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#222;max-width:700px;margin:auto;">
                <h2 style="background:#2ecc71;color:#fff;padding:12px 18px;border-radius:6px 6px 0 0;margin:0 0 12px 0;">Support Ticket Details</h2>
                <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:15px;width:100%;margin-bottom:18px;">
                    <tr><td style="font-weight:bold;width:140px;">Subject:</td><td>${ticketData.subject || 'No Subject'}</td></tr>
                    <tr><td style="font-weight:bold;width:140px;">Full Name:</td><td>${ticketData.fullName}</td></tr>
                    <tr><td style="font-weight:bold;">Company Name:</td><td>${ticketData.companyName || 'Not Provided'}</td></tr>
                    <tr><td style="font-weight:bold;">Province:</td><td>${ticketData.province || 'Not Provided'}</td></tr>
                    <tr><td style="font-weight:bold;">Email:</td><td>${ticketData.email}</td></tr>
                    <tr><td style="font-weight:bold;">Phone:</td><td>${ticketData.phone}</td></tr>
                </table>
                
                ${remoteSupportHtml}
                
                <div style="background:#f8f9fa;padding:12px;border-radius:6px;margin-bottom:18px;">
                    <h3 style="margin:0 0 10px 0;color:#2c3e50;">Issue Description:</h3>
                    <div style="white-space:pre-line;">${ticketData.description}</div>
                </div>
                
                ${systemInfoTable(ticketData.systemInfo)}
                
                <div style="margin-top:24px;padding:12px;background:#f5f5f5;border-radius:6px;font-size:13px;color:#666;border-left:4px solid #2ecc71;">
                    <strong>Note:</strong> This is an automated support ticket. A DBS Technology support agent will contact you shortly.
                </div>
            </div>
        `;

        // Send email using nodemailer (existing logic)
        const transporter = nodemailer.createTransport({
          host: 'za-smtp-outbound-1.mimecast.co.za',
          port: 587,
          secure: false, // Use TLS
          auth: {
            user: 'no-reply@dbstech.co.za',
            pass: 'Insc@pe2026NOT#'
          },
          tls: {
            // Do not fail on invalid certs
            rejectUnauthorized: false
          }
        });

        const mailOptions = {
          from: `"${ticketData.fullName} via DBS Support Desk" <${ticketData.email}>`,
          to: 'support@dbstech.co.za',
          cc: ticketData.email,
          subject: ticketData.subject || `Support Ticket from ${ticketData.fullName}`,
          text: emailContent,
          html: emailHtml,
          replyTo: ticketData.email
        };

        console.log('Preparing to send ticket email:', mailOptions);
        const info = await transporter.sendMail(mailOptions);

        console.log('Ticket email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Ticket submission error:', error);
        return { success: false, error: error.message };
    }
});

// IPC handler to launch tools from the DBS Toolbox
ipcMain.on('launch-tool', async (event, { path: toolPath, name }) => {
  try {
    log.info(`Launching tool: ${name} (${toolPath})`);
    
    // Ensure we're using the correct path for production
    let finalPath = toolPath;
    if (app.isPackaged) {
      // In production, ensure we're using the app.asar.unpacked directory
      finalPath = toolPath.replace('app.asar', 'app.asar.unpacked');
      log.info(`Adjusted path for production: ${finalPath}`);
    }
    
    // Normalize the path to handle any path separators
    const normalizedPath = path.normalize(finalPath);
    log.info(`Normalized tool path: ${normalizedPath}`);
    
    // Check if the tool exists
    if (!fs.existsSync(normalizedPath)) {
      const errorMsg = `Tool not found at path: ${normalizedPath}`;
      log.error(errorMsg);
      throw new Error(errorMsg);
    }
    
    log.info(`File exists, attempting to launch: ${normalizedPath}`);
    
    // Use shell.openPath for better Windows compatibility
    const { shell } = require('electron');
    const result = await shell.openPath(normalizedPath);
    
    if (result) {
      // If shell.openPath returns a non-empty string, it means there was an error
      throw new Error(`Failed to launch tool: ${result}`);
    }
    
    log.info(`Successfully requested launch of ${name}`);
    
    // Send success notification to renderer
    if (mainWindow) {
      mainWindow.webContents.send('tool-launched', { 
        success: true, 
        name,
        message: `${name} launched successfully`
      });
    }
  } catch (error) {
    log.error(`Error launching tool ${name}:`, error);
    
    // Send error notification to renderer
    if (mainWindow) {
      mainWindow.webContents.send('tool-error', { 
        name,
        error: error.message 
      });
    }
  }
});

// Add this near other IPC handlers, maybe after the 'get-system-info' handler
ipcMain.handle('get-tools-list', async () => {
  const toolsDir = path.join(__dirname, 'tools', 'dbs-utilities');
  try {
    const files = fs.readdirSync(toolsDir);
    return { success: true, tools: files };
  } catch (error) {
    log.error('Error reading tools directory:', error);
    return { success: false, error: error.message };
  }
});

// Generate a random password for remote support sessions
function generateRemoteSupportPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password = 'DBS-';
  for (let i = 0; i < 5; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Get the remote support executable path
function getRemoteSupportExePath() {
  if (app.isPackaged) {
    const appPath = process.resourcesPath;
    return path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'tools', 'dbs-utilities', REMOTE_SUPPORT_EXE);
  } else {
    return path.join(__dirname, 'tools', 'dbs-utilities', REMOTE_SUPPORT_EXE);
  }
}

// ===== Forced Remote Support password =====
// The custom QS build is compiled with disable-settings, so `--password` is
// rejected ("Settings are disabled!"). RustDesk instead accepts a permanent
// password stored in its config TOML as:
//   password = '01' + base64( [0x01] + nonce(24) + secretbox('00' + base64(sha256(pw+salt))) )
// The secretbox (XSalsa20-Poly1305) key is the machine UUID bytes, with fallback
// to the key_pair public key on decrypt — we encrypt with the pubkey, which
// always succeeds. Write the TOML before launch, then start the app normally.
// Works identically on macOS and Windows.

function getMachineUid() {
  try {
    if (PLATFORM_CONFIG.isMac) {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8' });
      const m = out.match(/IOPlatformUUID" = "([^"]+)"/);
      return m ? m[1] : null;
    }
    if (PLATFORM_CONFIG.isWindows) {
      const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8' });
      const m = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      return m ? m[1] : null;
    }
  } catch (e) {
    console.error('Failed to get machine UID:', e.message);
  }
  return null;
}

// Locate the QS config TOML for the current platform
function getRemoteSupportConfigTomlPath(exeName) {
  if (PLATFORM_CONFIG.isMac) {
    return path.join(os.homedir(), 'Library', 'Preferences', `com.carriez.${exeName}`, `${exeName}.toml`);
  }
  // Windows: RustDesk stores config under %APPDATA%/<exeName>/config/<exeName>.toml
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const candidates = [
    path.join(appData, exeName, 'config', `${exeName}.toml`),
    path.join(appData, exeName, `${exeName}.toml`),
    path.join(appData, 'RustDesk', 'config', 'RustDesk.toml')
  ];
  return candidates.find(p => fs.existsSync(p)) || candidates[0];
}

// Extract the key_pair public key (bytes 32..64) from a RustDesk TOML
function getKeyPairPubkeyFromToml(content) {
  const m = content.match(/key_pair\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return null;
  const nums = m[1].match(/\d+/g);
  if (!nums || nums.length < 64) return null;
  return Uint8Array.from(nums.slice(0, 64).map(Number)).subarray(32, 64);
}

// Write a forced permanent password into the QS config TOML
function forceRemoteSupportPassword(tomlPath, password) {
  let content = '';
  try { content = fs.readFileSync(tomlPath, 'utf8'); } catch {}

  // Reuse existing salt or generate a new 32-char one (RustDesk password charset)
  const saltMatch = content.match(/^salt\s*=\s*'([^']*)'/m);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const salt = saltMatch ? saltMatch[1]
    : Array.from(crypto.randomBytes(32)).map(b => chars[b % chars.length]).join('');

  // Encryption key: prefer the key_pair pubkey (always works via decrypt fallback)
  let keyBytes = getKeyPairPubkeyFromToml(content);
  if (!keyBytes) {
    const uid = getMachineUid();
    if (!uid) throw new Error('Cannot derive QS encryption key (no key_pair or machine UID)');
    keyBytes = Buffer.from(uid, 'utf8');
  }
  const key = new Uint8Array(32);
  key.set(keyBytes.subarray(0, 32));

  // h1 = sha256(password + salt); hashed storage = '00' + base64(h1)
  const h1 = crypto.createHash('sha256').update(password + salt, 'utf8').digest();
  const hashedStorage = '00' + h1.toString('base64');

  // encrypted storage = '01' + base64([0x01] + nonce + secretbox(hashedStorage))
  const nonce = nacl.randomBytes(24);
  const ct = nacl.secretbox(Buffer.from(hashedStorage, 'utf8'), nonce, key);
  const storage = '01' + Buffer.concat([Buffer.from([1]), Buffer.from(nonce), Buffer.from(ct)]).toString('base64');

  // Insert/replace top-level keys (must precede any [section])
  const setKey = (toml, key, value) => {
    const re = new RegExp(`^${key}\\s*=\\s*'[^']*'`, 'm');
    return re.test(toml) ? toml.replace(re, `${key} = '${value}'`) : `${key} = '${value}'\n` + toml;
  };
  content = setKey(content, 'password', storage);
  content = setKey(content, 'salt', salt);

  fs.mkdirSync(path.dirname(tomlPath), { recursive: true });
  fs.writeFileSync(tomlPath, content);
  log.info(`Forced Remote Support password written to ${tomlPath}`);
}

// Stop a running QS instance so it can't overwrite the config we just wrote
async function stopRemoteSupportIfRunning(exeName) {
  const cmd = PLATFORM_CONFIG.isMac
    ? `pkill -f "${exeName}"`
    : `taskkill /IM "${exeName}.exe" /F`;
  try { await execAsync(cmd); await new Promise(r => setTimeout(r, 1000)); } catch {}
}

// Read a string value from a macOS plist (handles XML and binary plists)
function readPlistValue(plistPath, key) {
  try {
    if (!fs.existsSync(plistPath)) return null;
    let content;
    try {
      const { execSync } = require('child_process');
      content = execSync(`plutil -convert xml1 -o - "${plistPath}"`, { encoding: 'utf8' });
    } catch {
      content = fs.readFileSync(plistPath, 'utf8');
    }
    const match = content.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`));
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

// Get the remote support DMG path for the current macOS architecture
function getRemoteSupportDmgPath() {
  const dmgName = REMOTE_SUPPORT_DMG[process.arch] || REMOTE_SUPPORT_DMG.arm64;
  const baseDir = app.isPackaged
    ? path.join(process.resourcesPath, 'tools', 'dbs-utilities')
    : path.join(__dirname, 'tools', 'dbs-utilities');
  return path.join(baseDir, dmgName);
}

// Read CFBundleExecutable from an .app bundle and return the inner binary path
function getAppBundleBinaryPath(appBundlePath) {
  const executable = readPlistValue(path.join(appBundlePath, 'Contents', 'Info.plist'), 'CFBundleExecutable');
  if (!executable) return null;
  const binaryPath = path.join(appBundlePath, 'Contents', 'MacOS', executable);
  return fs.existsSync(binaryPath) ? binaryPath : null;
}

// Extract the Remote Support .app bundle from its DMG (first launch only) and return the binary path
async function ensureRemoteSupportMacApp() {
  const { execSync } = require('child_process');
  const destDir = path.join(app.getPath('userData'), 'remote-support');
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

  // Already extracted? Reuse the existing .app bundle
  const existing = fs.readdirSync(destDir).find(f => f.endsWith('.app'));
  if (existing) {
    const appPath = path.join(destDir, existing);
    const binaryPath = getAppBundleBinaryPath(appPath);
    if (binaryPath) return { appPath, binaryPath };
  }

  const dmgPath = getRemoteSupportDmgPath();
  console.log(`Remote Support DMG path: ${dmgPath}`);
  if (!fs.existsSync(dmgPath)) {
    throw new Error(`Remote Support DMG not found at path: ${dmgPath}`);
  }

  // Remove quarantine from the DMG (best effort) so it mounts without Gatekeeper prompts
  try { execSync(`xattr -d com.apple.quarantine "${dmgPath}"`); } catch {}

  // Mount the DMG at a dedicated mount point
  const mountPoint = path.join(app.getPath('userData'), 'remote-support-mount');
  // Detach any stale mount from a previous run (best effort)
  try { execSync(`hdiutil detach "${mountPoint}" -quiet`); } catch {}
  if (!fs.existsSync(mountPoint)) fs.mkdirSync(mountPoint, { recursive: true });
  execSync(`hdiutil attach "${dmgPath}" -nobrowse -readonly -mountpoint "${mountPoint}"`);

  try {
    // Find the .app bundle on the mounted volume
    const appBundle = fs.readdirSync(mountPoint).find(f => f.endsWith('.app'));
    if (!appBundle) throw new Error('No .app bundle found inside Remote Support DMG');

    // Copy the .app bundle out of the mounted volume
    execSync(`cp -R "${path.join(mountPoint, appBundle)}" "${destDir}/"`);
  } finally {
    // Always detach the DMG (best effort)
    try { execSync(`hdiutil detach "${mountPoint}" -quiet`); } catch {}
  }

  // Clear quarantine attributes on the extracted bundle (unsigned app, best effort)
  const extracted = fs.readdirSync(destDir).find(f => f.endsWith('.app'));
  if (!extracted) throw new Error('Failed to extract Remote Support app bundle from DMG');
  try { execSync(`xattr -cr "${path.join(destDir, extracted)}"`); } catch {}

  const appPath = path.join(destDir, extracted);
  const binaryPath = getAppBundleBinaryPath(appPath);
  if (!binaryPath) throw new Error('Could not determine Remote Support executable inside app bundle');

  // Ensure the binary is executable
  try { execSync(`chmod +x "${binaryPath}"`); } catch {}

  console.log(`Remote Support app extracted to: ${appPath}`);
  return { appPath, binaryPath };
}

// Get the RustDesk ID by running the exe with --get-id
function getRemoteSupportId(exePath) {
  return new Promise((resolve, reject) => {
    exec(`"${exePath}" --get-id`, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        console.error('Error getting remote support ID:', error);
        reject(error);
      } else {
        // Extract the ID from stdout - it's the last numeric line
        const lines = stdout.trim().split('\n');
        let id = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (/^\d+$/.test(line)) {
            id = line;
            break;
          }
        }
        if (id) {
          console.log('Remote Support ID:', id);
          resolve(id);
        } else {
          reject(new Error('Could not parse remote support ID from output'));
        }
      }
    });
  });
}

// Detect the inner executable name the QS wrapper actually runs as (Windows).
// Newer QS builds self-extract to %LOCALAPPDATA%\<inner-name> and the wrapper
// prints `executing <path>\<inner-name>.exe` when invoked. The config TOML and
// taskkill must target the inner name, not the wrapper file name.
async function probeRemoteSupportWindowsInnerName(wrapperPath) {
  const wrapperName = path.basename(wrapperPath).replace(/\.exe$/i, '');
  return new Promise((resolve) => {
    exec(`"${wrapperPath}" --get-id`, { timeout: 60000, windowsHide: true }, (error, stdout) => {
      const m = (stdout || '').match(/executing\s+.*[\\\/]([^\\\/]+)\.exe/i);
      if (m && m[1]) {
        console.log(`Remote Support inner executable detected: ${m[1]}`);
        resolve(m[1]);
      } else {
        console.warn(`Could not detect Remote Support inner name, falling back to: ${wrapperName}`);
        resolve(wrapperName);
      }
    });
  });
}

// Consolidated Remote Support launch handler
function setupRemoteSupportHandler() {
  // Prevent multiple initializations
  if (isRemoteSupportHandlerInitialized) {
    console.log('Remote Support handler already initialized');
    return;
  }

  console.log('Initializing Remote Support handler...');
  
  // Remove all existing 'launch-remote-support' handlers
  ipcMain.removeHandler('launch-remote-support');

  // Add new handler - accepts optional password, launches exe, and returns ID
  ipcMain.handle('launch-remote-support', async (event, password) => {
    console.log('Remote Support launch handler called');

    try {
      // If 'generate' was passed, generate a random password
      if (password === 'generate') {
        password = generateRemoteSupportPassword();
        console.log('Generated password:', password);
      }

      // Resolve the launch target for the current platform
      let launchPath;
      let macAppPath = null;
      if (PLATFORM_CONFIG.isMac) {
        console.log('macOS detected - preparing Remote Support app from DMG...');
        const rs = await ensureRemoteSupportMacApp();
        macAppPath = rs.appPath;
        launchPath = rs.binaryPath;
      } else {
        launchPath = getRemoteSupportExePath();
      }
      console.log(`Remote Support launch path: ${launchPath}`);

      // Check that the launch target exists
      if (!fs.existsSync(launchPath)) {
        const errorMsg = `Remote Support tool not found at path: ${launchPath}`;
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      console.log('File exists, attempting to launch Remote Support...');

      if (password) {
        console.log('Launching with custom password');
        // The QS build rejects --password (disable-settings), so write the
        // permanent password into its config TOML before launching instead.
        let exeName = path.basename(launchPath).replace(/\.exe$/i, '');
        if (PLATFORM_CONFIG.isWindows) {
          // The wrapper runs an inner binary under a different name (e.g.
          // dbs-remoteassist-win); the config TOML and taskkill must target it.
          exeName = await probeRemoteSupportWindowsInnerName(launchPath);
        }
        await stopRemoteSupportIfRunning(exeName);
        const tomlPath = getRemoteSupportConfigTomlPath(exeName);
        try {
          forceRemoteSupportPassword(tomlPath, password);
        } catch (e) {
          console.error('Failed to force Remote Support password:', e);
          log.warn(`Could not force remote support password: ${e.message}`);
        }
      }

      // Launch the app normally so its window appears and it registers online.
      // Never pass --password: this build treats it as a CLI command and exits.
      if (PLATFORM_CONFIG.isMac) {
        exec(`open "${macAppPath}"`, (error) => {
          if (error) console.error('Error launching Remote Support via open:', error);
        });
      } else {
        const result = await shell.openPath(launchPath);
        if (result) {
          throw new Error(`Failed to launch Remote Support: ${result}`);
        }
      }

      console.log('Successfully launched Remote Support');

      // If a password was provided, we need to get the ID for the ticket
      if (password) {
        // Wait a few seconds for the app to initialize and register with the server
        console.log('Waiting for Remote Support to initialize before reading ID...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Try to get the ID with retries
        let remoteId = null;
        const maxRetries = 3;
        for (let i = 0; i < maxRetries; i++) {
          try {
            remoteId = await getRemoteSupportId(launchPath);
            break;
          } catch (err) {
            console.warn(`Attempt ${i + 1} to get ID failed:`, err.message);
            if (i < maxRetries - 1) {
              await new Promise(resolve => setTimeout(resolve, 3000));
            }
          }
        }

        if (remoteId) {
          return { success: true, remoteId, password };
        } else {
          // Launched successfully but couldn't get ID
          return { success: true, remoteId: null, password, warning: 'Remote Support launched but could not retrieve ID automatically' };
        }
      }

      return { success: true };
    } catch (error) {
      console.error('Remote Support handler error:', error);
      throw error;
    }
  });

  isRemoteSupportHandlerInitialized = true;
  console.log('Remote Support handler initialized successfully');
}

/**
 * Create the application window
 */
function createWindow() {
  // Get the primary display dimensions
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  // Window dimensions with 4% height reduction
  const windowWidth = 380;  // Width remains the same
  const margin = 20;        // Margin from screen edges

  // Fill the available work area height (minus margins) so the whole form is visible
  const windowHeight = Math.max(700, height - margin * 2);

  // Create the browser window with native title bar
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: width - windowWidth - margin, // Position on right side
    y: height - windowHeight - margin, // Position near bottom
    minWidth: 380,
    minHeight: 700, // Minimum height for smaller screens
    show: true, // Changed from false to true to show window on startup
    title: `DBS Support Desk v${version}`,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
      spellcheck: true,
      webviewTag: true,
      contextMenu: true,
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'DBS_Logo.ico'),
    frame: true, // Keep native frame
    backgroundColor: '#f5f5f5', // Light gray background to match the form
    skipTaskbar: false, // Show in taskbar
    resizable: true,
    autoHideMenuBar: false, // Changed from true to false to show menu bar by default
    titleBarStyle: 'default',
    titleBarOverlay: false
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Show the window when it's ready
  mainWindow.once('ready-to-show', () => {
    console.log('Window is ready');
    // Set the version in the title bar
    mainWindow.setTitle(`DBS Support Desk v${version}`);
    
    // Ensure content is properly sized
    mainWindow.webContents.on('did-finish-load', () => {
      // Add some CSS to ensure proper spacing
      mainWindow.webContents.insertCSS(`
        body {
          padding: 15px;
          margin: 0;
          box-sizing: border-box;
        }
        .form-container {
          max-width: 100%;
          box-sizing: border-box;
        }
        .form-group {
          margin-bottom: 15px;
        }
      `);
    });
  });

  // Handle window close event (minimize to tray instead of quitting)
  mainWindow.on('close', (event) => {
    if (!isAppQuitting) {
      console.log('Window close prevented, minimizing to tray');
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
    return true;
  });
  
  // Handle minimize event
  mainWindow.on('minimize', (event) => {
    console.log('Window minimize event');
    event.preventDefault();
    mainWindow.hide();
  });

  // Enable built-in spell checker with multiple languages
  mainWindow.webContents.session.setSpellCheckerEnabled(true);
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US', 'en-GB']);

  // Enable context menu for text inputs
  mainWindow.webContents.on('context-menu', (event, params) => {
    if (params.isEditable) {
      event.preventDefault();
      const { Menu, MenuItem } = require('electron');
      const menu = new Menu();
      
      // Add each spelling suggestion
      if (params.dictionarySuggestions.length > 0) {
        params.dictionarySuggestions.forEach(suggestion => {
          menu.append(new MenuItem({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion)
          }));
        });
        menu.append(new MenuItem({ type: 'separator' }));
      }
      
      // Add standard editing options
      menu.append(new MenuItem({
        label: 'Undo',
        role: 'undo',
        enabled: params.editFlags.canUndo
      }));
      
      menu.append(new MenuItem({
        label: 'Redo',
        role: 'redo',
        enabled: params.editFlags.canRedo
      }));
      
      menu.append(new MenuItem({ type: 'separator' }));
      
      menu.append(new MenuItem({
        label: 'Cut',
        role: 'cut',
        enabled: params.editFlags.canCut
      }));
      
      menu.append(new MenuItem({
        label: 'Copy',
        role: 'copy',
        enabled: params.editFlags.canCopy
      }));
      
      menu.append(new MenuItem({
        label: 'Paste',
        role: 'paste',
        enabled: params.editFlags.canPaste
      }));
      
      menu.popup();
    }
  });

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Enable DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// Auto-update functionality
async function checkAppDirectoryAccess() {
  try {
    // Use the user data directory instead of the app directory
    const userDataPath = app.getPath('userData');
    log.info(`Checking write access to user data directory: ${userDataPath}`);
    
    // Create the directory if it doesn't exist
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    
    // Test write access by creating a temporary file
    const testFilePath = path.join(userDataPath, 'write-test.tmp');
    fs.writeFileSync(testFilePath, 'test');
    fs.unlinkSync(testFilePath);
    
    log.info('Write access to user data directory: Granted');
    return true;
  } catch (error) {
    log.error(`No write access to user data directory: ${error.message}`);
    return false;
  }
}

// ===== Custom macOS updater for unsigned builds =====
// electron-updater's macOS backend requires a signed app (Squirrel verifies
// signatures), so unsigned builds can't use it. Instead we fetch
// latest-mac.yml from the latest GitHub release, download the arch-matched
// zip, swap the .app bundle in place, strip quarantine, and relaunch.
// Uses the same renderer events as the Windows updater.

const MAC_UPDATE_BASE = 'https://github.com/dbsdeskza/dbs-support-desk/releases';
let pendingMacUpdate = null;       // { version, zipUrl, sha512, size }
let downloadedMacUpdateZip = null;

function httpGetBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'DBS-Support-Desk' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        return resolve(httpGetBuffer(res.headers.location, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function httpDownloadFile(url, dest, onProgress, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'DBS-Support-Desk' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects <= 0) return reject(new Error('Too many redirects'));
        return resolve(httpDownloadFile(res.headers.location, dest, onProgress, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} downloading ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress) onProgress(received, total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

function isNewerVersion(latest, current) {
  const a = String(latest).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

async function checkMacUpdate(manualCheck = false) {
  const send = (ch, data) => { if (mainWindow) mainWindow.webContents.send(ch, data); };
  if (!app.isPackaged) {
    log.info('Skipping mac update check - running in dev mode');
    if (manualCheck) send('update-not-available', { version: app.getVersion() });
    return null;
  }
  try {
    send('update-status', 'Checking for updates...');
    const yml = (await httpGetBuffer(`${MAC_UPDATE_BASE}/latest/download/latest-mac.yml`)).toString();
    const version = (yml.match(/^version:\s*(\S+)/m) || [])[1];
    const files = [];
    const fileRe = /-\s*url:\s*(\S+)\s*\n\s*sha512:\s*(\S+)\s*\n\s*size:\s*(\d+)/g;
    let m;
    while ((m = fileRe.exec(yml))) files.push({ url: m[1], sha512: m[2], size: +m[3] });

    if (!version || !files.length) throw new Error('Invalid latest-mac.yml');
    log.info(`Latest mac release: v${version} (current: ${app.getVersion()})`);

    if (!isNewerVersion(version, app.getVersion())) {
      send('update-not-available', { version });
      return null;
    }

    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const zipFile = files.find(f => f.url.endsWith(`${arch}.zip`));
    if (!zipFile) throw new Error(`No ${arch} zip asset in latest release`);

    pendingMacUpdate = {
      version,
      zipUrl: `${MAC_UPDATE_BASE}/download/v${version}/${zipFile.url}`,
      sha512: zipFile.sha512,
      size: zipFile.size
    };
    send('update-available', { version });
    return pendingMacUpdate;
  } catch (e) {
    log.error('Mac update check failed:', e);
    if (manualCheck) send('update-error', `Update check failed: ${e.message}`);
    return null;
  }
}

async function downloadMacUpdate(update) {
  const send = (ch, data) => { if (mainWindow) mainWindow.webContents.send(ch, data); };
  const updateDir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(updateDir, { recursive: true });
  const zipPath = path.join(updateDir, `dbs-support-desk-${update.version}.zip`);

  await httpDownloadFile(update.zipUrl, zipPath, (received, total) => {
    send('download-progress', {
      percent: total ? (received / total) * 100 : 0,
      transferred: received,
      total: total || update.size
    });
  });

  // Verify sha512 integrity against latest-mac.yml
  const hash = crypto.createHash('sha512').update(fs.readFileSync(zipPath)).digest('base64');
  if (hash !== update.sha512) {
    fs.unlinkSync(zipPath);
    throw new Error('Update download failed integrity check');
  }
  return zipPath;
}

async function installMacUpdate(zipPath) {
  const updateDir = path.dirname(zipPath);
  const extractDir = path.join(updateDir, 'extracted');
  // rm -rf, not fs.rmSync — Electron's patched fs treats *.asar as a directory
  await execAsync(`rm -rf "${extractDir}"`).catch(() => {});
  fs.mkdirSync(extractDir, { recursive: true });
  await execAsync(`ditto -x -k "${zipPath}" "${extractDir}"`);

  const appName = fs.readdirSync(extractDir).find(f => f.endsWith('.app'));
  if (!appName) throw new Error('No .app bundle found in update package');
  const newApp = path.join(extractDir, appName);

  // Bundle path of the running app: .../X.app/Contents/MacOS/exe → up 3
  const currentApp = path.resolve(path.dirname(app.getPath('exe')), '..', '..');
  if (!currentApp.endsWith('.app')) {
    throw new Error('Cannot determine current .app bundle path');
  }
  fs.accessSync(path.dirname(currentApp), fs.constants.W_OK);

  // Move the running bundle aside (allowed on APFS while running), copy the
  // new one into place, roll back on failure.
  // NOTE: never use fs.rmSync on paths containing .asar — Electron patches fs
  // to treat *.asar as a virtual directory (rmdir → ENOTDIR). Use rm -rf.
  const backupApp = `${currentApp}.old`;
  await execAsync(`rm -rf "${backupApp}"`).catch(() => {});
  fs.renameSync(currentApp, backupApp);
  try {
    await execAsync(`ditto "${newApp}" "${currentApp}"`);
  } catch (e) {
    fs.renameSync(backupApp, currentApp);
    throw e;
  }
  await execAsync(`xattr -dr com.apple.quarantine "${currentApp}"`).catch(() => {});
  await execAsync(`rm -rf "${backupApp}" "${updateDir}"`).catch(e =>
    log.warn('Update cleanup failed (non-fatal):', e.message));

  log.info('Mac update installed, relaunching...');
  app.relaunch();
  app.exit(0);
}

async function checkForUpdates(manualCheck = false) {
  if (PLATFORM_CONFIG.isMac) {
    return checkMacUpdate(manualCheck);
  }
  try {
    log.info('Checking for updates...');
    
    // Always check the user data directory, not the app directory
    const hasAccess = await checkAppDirectoryAccess();
    if (!hasAccess) {
      const errorMsg = 'Cannot check for updates: No write access to user data directory';
      log.error(errorMsg);
      if (mainWindow && manualCheck) {
        mainWindow.webContents.send('update-error', errorMsg);
      }
      return { success: false, error: errorMsg };
    }

    // Set the feed URL for GitHub releases
    const updateServerUrl = 'https://github.com/dbsdeskza/dbs-support-desk';
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'dbsdeskza',
      repo: 'dbs-support-desk',
      private: false
    });
    
    log.info('Feed URL set, checking for updates...');
    
    // Check for updates
    const updateCheckResult = await autoUpdater.checkForUpdates();
    log.info('Update check result:', updateCheckResult ? 'Update available' : 'No updates available');
    
    return { success: true, updateInfo: updateCheckResult };
    
  } catch (error) {
    const errorMsg = `Error checking for updates: ${error.message}`;
    log.error(errorMsg);
    if (mainWindow && manualCheck) {
      mainWindow.webContents.send('update-error', errorMsg);
    }
    return { success: false, error: errorMsg };
  }
}

// Configure auto-updater
function setupAutoUpdater() {
  if (PLATFORM_CONFIG.isMac) {
    // Custom unsigned-build updater: check on start and every 4 hours
    log.info('Setting up custom macOS updater (unsigned build)...');
    setTimeout(() => {
      log.info('Performing initial update check...');
      checkMacUpdate();
    }, 3000);
    setInterval(() => checkMacUpdate(), 4 * 60 * 60 * 1000);
    return;
  }
  log.info('Setting up auto-updater...');
  
  // Configure auto-updater
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.fullChangelog = true;
  
  // Set feed URL for GitHub releases
  const repo = 'dbsdeskza/dbs-support-desk';
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'dbsdeskza',
    repo: 'dbs-support-desk',
    private: false,
    vPrefixedTagName: true,
    releaseType: 'release',
  });

  // Event listeners
  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...');
    if (mainWindow) {
      mainWindow.webContents.send('update-status', 'Checking for updates...');
    }
  });

  autoUpdater.on('update-available', (info) => {
    log.info('Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', info);
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    log.info('No updates available');
    if (mainWindow) {
      mainWindow.webContents.send('update-not-available', info);
    }
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const percent = Math.floor(progressObj.percent || 0);
    log.info(`Download progress: ${percent}%`);
    if (mainWindow) {
      mainWindow.webContents.send('download-progress', progressObj);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded, will install in 5s');
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', info);
    }
    // Auto install after 5 seconds
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 5000);
  });

  autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater:', err);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', `Auto-update error: ${err.message}`);
    }
  });
  
  // Initial check for updates after a short delay
  setTimeout(() => {
    log.info('Performing initial update check...');
    checkForUpdates();
  }, 3000);
  
  // Check for updates every 4 hours
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}

// IPC handler for manual update check
ipcMain.on('check-for-updates', () => {
  log.info('Manual update check requested');
  checkForUpdates(true);
});

// IPC handler for manual download and install
ipcMain.handle('download-and-install-update', async () => {
  try {
    if (PLATFORM_CONFIG.isMac) {
      // Custom unsigned-build update: download → verify → swap .app → relaunch
      if (downloadedMacUpdateZip) {
        log.info('Mac update already downloaded, installing...');
        if (mainWindow) mainWindow.webContents.send('update-downloaded', {});
        await installMacUpdate(downloadedMacUpdateZip);
        return { success: true };
      }
      if (!pendingMacUpdate) {
        await checkMacUpdate(true);
      }
      if (!pendingMacUpdate) {
        return { success: false, error: 'No update available' };
      }
      log.info(`Downloading mac update v${pendingMacUpdate.version}...`);
      downloadedMacUpdateZip = await downloadMacUpdate(pendingMacUpdate);
      log.info('Mac update downloaded, installing...');
      if (mainWindow) mainWindow.webContents.send('update-downloaded', { version: pendingMacUpdate.version });
      await installMacUpdate(downloadedMacUpdateZip);
      return { success: true, version: pendingMacUpdate.version };
    }
    log.info('Starting manual update process...');
    
    if (!autoUpdater) {
      log.error('AutoUpdater is not initialized');
      return { success: false, error: 'AutoUpdater not initialized' };
    }

    log.info('Checking for updates...');
    const updateCheckResult = await autoUpdater.checkForUpdates();
    
    if (!updateCheckResult || !updateCheckResult.updateInfo) {
      log.error('No update information available');
      return { success: false, error: 'No update information available' };
    }

    const { version, path, releaseNotes } = updateCheckResult.updateInfo;
    log.info(`Update found: v${version}`, { path, releaseNotes });

    if (mainWindow) {
      mainWindow.webContents.send('update-status', `Found update v${version}, preparing download...`);
    }

    // Set up event listeners for the download
    return new Promise((resolve) => {
      autoUpdater.once('download-progress', (progressObj) => {
        log.info('Download progress:', progressObj);
        if (mainWindow) {
          mainWindow.webContents.send('download-progress', progressObj);
        }
      });

      autoUpdater.once('update-downloaded', (info) => {
        log.info('Update downloaded:', info);
        if (mainWindow) {
          mainWindow.webContents.send('update-downloaded', info);
        }
        resolve({ success: true, version: info.version });
      });

      autoUpdater.once('error', (error) => {
        log.error('Download error:', error);
        if (mainWindow) {
          mainWindow.webContents.send('update-error', error.message);
        }
        resolve({ success: false, error: error.message });
      });

      // Start the download
      log.info('Starting download...');
      autoUpdater.downloadUpdate().catch(error => {
        log.error('Failed to start download:', error);
        if (mainWindow) {
          mainWindow.webContents.send('update-error', `Failed to start download: ${error.message}`);
        }
        resolve({ success: false, error: error.message });
      });
    });
  } catch (error) {
    log.error('Error in download handler:', error);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', `Update error: ${error.message}`);
    }
    return { success: false, error: error.message };
  }
});

// IPC handler for force closing the app
ipcMain.on('force-close-app', () => {
  log.info('Force closing app for update...');
  
  // Close all windows
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(window => {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  });
  
  // Force exit after a short delay
  setTimeout(() => {
    log.info('Force exiting app...');
    app.exit(0);
  }, 500);
});

// IPC handler for restarting the app
ipcMain.on('restart-app', async () => {
  log.info('Preparing to restart app for update...');
  
  try {
    // Close all windows
    const windows = BrowserWindow.getAllWindows();
    for (const window of windows) {
      window.removeAllListeners('close');
      window.close();
    }
    
    // Give some time for windows to close
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Force quit the app
    log.info('Calling quitAndInstall...');
    
    // First try the normal way
    const success = autoUpdater.quitAndInstall(false, true);
    
    // If that fails, force close after a delay
    if (!success) {
      log.warn('quitAndInstall returned false, forcing close...');
      setTimeout(() => {
        app.exit(0);
      }, 1000);
    }
    
  } catch (error) {
    log.error('Error during restart:', error);
    // If we get here, try the forceful approach
    app.exit(0);
    process.exit(0);
  }
});

// IPC handler to get the app version
// Removed duplicate IPC handler

// Handle theme preference changes
ipcMain.on('theme-changed', (event, theme) => {
  // Save theme preference to disk if needed
  // This can be used to persist theme across app restarts
  if (mainWindow) {
    mainWindow.webContents.send('set-theme', theme);
  }
});

// Listen for system theme changes
systemPreferences.on('updated', (event, change) => {
  if (change === 'systemPreferences' && mainWindow) {
    const isDarkMode = systemPreferences.isDarkMode();
    mainWindow.webContents.send('system-theme-changed', isDarkMode ? 'dark' : 'light');
  }
});

// Handle before-quit event
app.on('before-quit', (e) => {
  log.info('App is about to quit...');
  // Prevent the default quit behavior to ensure our cleanup runs
  e.preventDefault();
  
  // Close all windows
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
  
  // Force quit after a short delay
  setTimeout(() => {
    app.exit(0);
  }, 1000);
});

// Auto-update error handler
process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', reason instanceof Error ? reason.message : String(reason));
  }
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error);
  if (mainWindow) {
    mainWindow.webContents.send('update-error', error.message || 'An unexpected error occurred');
  }
});

// Create and configure the system tray icon and context menu
function createSystemTray() {
  // Clean up existing tray if it exists
  if (tray) {
    try {
      tray.destroy();
    } catch (e) {
      console.error('Error destroying existing tray:', e);
    }
    tray = null;
  }

  try {
    console.log('Creating system tray...');
    
    // Handle icon path for both development and production (PNG on macOS, ICO on Windows)
    const iconFile = PLATFORM_CONFIG.isMac ? 'DBS_Logo_32.png' : 'DBS_Logo.ico';
    let iconPath;
    if (app.isPackaged) {
      // In production, use resources path
      iconPath = path.join(process.resourcesPath, 'assets', iconFile);
    } else {
      // In development, use the regular path
      iconPath = path.join(__dirname, 'assets', iconFile);
    }
    
    console.log('Using icon path:', iconPath);
    
    // Load the icon with error handling
    let trayIcon;
    try {
      trayIcon = nativeImage.createFromPath(iconPath);
      if (trayIcon.isEmpty()) {
        throw new Error('Icon file is empty or invalid');
      }
    } catch (error) {
      console.error('Failed to load tray icon:', error);
      // Fallback to a blank icon if the file can't be loaded
      trayIcon = nativeImage.createEmpty();
    }
    
    // Create the tray with the icon
    tray = new Tray(trayIcon);
    
    // Set the tooltip
    tray.setToolTip(`DBS Support Desk v${app.getVersion()}`);
    
    // Handle click events
    tray.on('click', () => {
      console.log('Tray icon clicked');
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    // Create and set context menu
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `DBS Support Desk v${app.getVersion()}`,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Show DBS Support Desk',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isAppQuitting = true;
          app.quit();
        }
      }
    ]);
    
    tray.setContextMenu(contextMenu);
    console.log('Tray created successfully');
    
  } catch (error) {
    console.error('Failed to create system tray:', error);
  }
}

// Toggle window visibility
function toggleWindow() {
  console.log('Toggling window...');
  
  if (!mainWindow) {
    console.log('No main window, creating new one...');
    createWindow();
    return;
  }

  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    console.log('Window is visible and focused, minimizing...');
    mainWindow.minimize();
    mainWindow.hide();
    if (PLATFORM_CONFIG.isMac) app.dock.hide();
  } else {
    console.log('Showing and focusing window...');
    if (PLATFORM_CONFIG.isMac) app.dock.show();
    
    if (mainWindow.isMinimized()) {
      console.log('Restoring minimized window...');
      mainWindow.restore();
    }
    
    mainWindow.show();
    mainWindow.focus();
    
    // Bring to front
    mainWindow.setAlwaysOnTop(true);
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(false);
  }
}

// Create application menu
function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'close', label: 'Close Window' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'window',
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      role: 'help',
      label: 'Help',
      submenu: [
        {
          label: 'Contact DBS Technology',
          click: async () => {
            const { shell } = require('electron')
            await shell.openExternal('https://dbstechnology.co.za/contact-us/')
          }
        },
        {
          label: 'About DBS Technology',
          click: async () => {
            const { shell } = require('electron')
            await shell.openExternal('https://dbstechnology.co.za/about-dbs-technology/')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function checkIconFiles() {
  const iconPaths = [
    path.join(__dirname, 'assets', 'DBS_Logo.ico'),
    path.join(__dirname, 'assets', 'icon.ico')
  ];

  console.log('\n=== Checking Icon Files ===');
  
  iconPaths.forEach(iconPath => {
    try {
      const exists = fs.existsSync(iconPath);
      console.log(`\nFile: ${iconPath}`);
      console.log(`Exists: ${exists}`);
      
      if (exists) {
        const stats = fs.statSync(iconPath);
        console.log(`Size: ${stats.size} bytes`);
        
        try {
          const img = nativeImage.createFromPath(iconPath);
          if (img.isEmpty()) {
            console.log('Status: Invalid or corrupted icon file');
          } else {
            console.log('Status: Valid icon file');
            console.log('Dimensions:', img.getSize());
            return img; // Return the first valid icon
          }
        } catch (e) {
          console.log('Error loading icon:', e.message);
        }
      }
    } catch (error) {
      console.error(`Error checking ${iconPath}:`, error.message);
    }
  });
  console.log('=== End of Icon Check ===\n');
  return null;
}

app.whenReady().then(() => {
  console.log('App starting...');
  
  // Check icon files first
  checkIconFiles();
  
  // Create the application menu
  createApplicationMenu();
  
  // Create the window (hidden by default)
  createWindow();
  
  // Create the system tray with the valid icon if available
  createSystemTray();
  
  // Set up other handlers
  setupRemoteSupportHandler();
  setupAutoUpdater();
  
  // Set up auto-start (Windows and macOS)
  enableAutoStart().then(enabled => {
    if (!enabled) {
      console.warn('Could not configure auto-start');
    }
  });
  
  // Initial update check after a short delay
  setTimeout(() => {
    checkForUpdates();
  }, 5000);
  
  console.log('App initialization complete');
}).catch(error => {
  console.error('Error during app initialization:', error);
});

// Update window and auto-start behavior to show window on startup and ensure proper auto-start configuration
async function enableAutoStart() {
  try {
    // Cross-platform login item registration (Windows Run key / macOS Login Items)
    app.setLoginItemSettings({
      openAtLogin: true,
      args: ['--minimized']
    });

    // Clean up legacy batch-file startup entry from older versions (Windows only)
    if (PLATFORM_CONFIG.isWindows) {
      try {
        require('child_process').execSync('REG DELETE "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v "DBS Support Desk" /f');
      } catch {}
      try {
        const legacyBat = path.join(app.getPath('userData'), 'dbs_support_desk_startup.bat');
        if (fs.existsSync(legacyBat)) fs.unlinkSync(legacyBat);
      } catch {}
    }

    console.log('Auto-start configured successfully');
    return true;
  } catch (error) {
    console.error('Error configuring auto-start:', error);
    return false;
  }
}
