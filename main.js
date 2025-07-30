const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog } = require('electron');
const path = require('path');
const nodemailer = require('nodemailer');
const si = require('systeminformation');
const { download } = require('electron-dl');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Configure logging
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('App starting...');

require('dotenv').config();

let mainWindow;
let tray;

// Predefined paths where TeamViewer might be installed
const TEAMVIEWER_PATHS = [
  'C:\\Program Files\\TeamViewer\\TeamViewer.exe',
  'C:\\Program Files (x86)\\TeamViewer\\TeamViewer.exe'
];

function isTeamViewerInstalled() {
  return TEAMVIEWER_PATHS.some(path => fs.existsSync(path));
}

function openFileOrFolder(filePath) {
  return new Promise((resolve, reject) => {
    console.log(`Attempting to open file: ${filePath}`);
    exec(`start "" "${filePath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error opening file: ${error}`);
        console.error(`stderr: ${stderr}`);
        reject(error);
      } else {
        console.log(`Successfully opened file: ${filePath}`);
        resolve();
      }
    });
  });
}

function downloadTeamViewerQuickSupport() {
  const tempDownloadPath = path.join(os.tmpdir(), 'TeamViewerQS.exe');
  const teamviewerDownloadUrl = 'https://download.teamviewer.com/download/TeamViewerQS.exe';

  return new Promise((resolve, reject) => {
    console.log(`Attempting to download TeamViewer Quick Support from: ${teamviewerDownloadUrl}`);
    console.log(`Download will be saved to: ${tempDownloadPath}`);

    download(mainWindow, teamviewerDownloadUrl, {
      directory: os.tmpdir(),
      filename: 'TeamViewerQS.exe',
      onProgress: (progress) => {
        console.log(`Download progress: ${(progress * 100).toFixed(2)}%`);
      }
    })
    .then(dl => {
      const downloadedPath = dl.getSavePath();
      console.log(`TeamViewer Quick Support downloaded successfully to: ${downloadedPath}`);

      // Verify file exists before attempting to open
      if (!fs.existsSync(downloadedPath)) {
        console.error(`Download failed: File not found at ${downloadedPath}`);
        return reject(new Error('Downloaded file not found'));
      }

      // Attempt to open the downloaded executable
      exec(`start "" "${downloadedPath}"`, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error launching TeamViewer Quick Support: ${error}`);
          console.error(`stderr: ${stderr}`);
          reject(error);
        } else {
          console.log('TeamViewer Quick Support launched successfully');
          resolve(downloadedPath);
        }
      });
    })
    .catch(error => {
      console.error('TeamViewer download error:', error);
      reject(error);
    });
  });
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
    const os = require('os');
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
      systemUptime
    ] = await Promise.all([
      si.osInfo(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces(),
      si.graphics(),
      si.battery(),
      si.time()
    ]);

    // Format system information
    return {
      // OS Details
      platform: `${osInfo.distro} ${osInfo.release} (${osInfo.arch})`,
      hostname: os.hostname(),
      
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
          const diskInfo = await si.fsSize();
          const diskLayout = await si.diskLayout();
          
          return diskInfo.map(disk => {
            // Find matching disk from layout for more details
            const matchedDisk = diskLayout.find(d => 
              disk.mount.toLowerCase().includes(d.device.toLowerCase())
            ) || {};

            // Ensure numeric calculations
            const totalSize = Number(disk.size);
            const usedSize = Number(disk.used);
            const freeSize = Number.isFinite(totalSize) && Number.isFinite(usedSize) 
              ? totalSize - usedSize 
              : 0;
            
            // Calculate usage percentage safely
            const usagePercent = Number.isFinite(totalSize) && Number.isFinite(usedSize)
              ? ((usedSize / totalSize) * 100)
              : 0;
            
            return {
              mount: disk.mount,
              type: disk.type || matchedDisk.type || 'Unknown',
              total: totalSize,
              used: usedSize,
              free: freeSize,
              usagePercent: usagePercent
            };
          });
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

          // Refined network interface filtering
          const refinedInterfaces = networkInterfaces
            .filter(net => {
              // Filter out non-meaningful interfaces
              const isValidInterface = 
                // Keep wireless and ethernet interfaces
                (net.type === 'wireless' || net.type === 'ethernet') &&
                // Exclude loopback and pseudo interfaces
                !net.iface.toLowerCase().includes('loopback') &&
                !net.iface.toLowerCase().includes('pseudo') &&
                // Exclude bluetooth and other non-network interfaces
                !net.iface.toLowerCase().includes('bluetooth') &&
                // Ensure we have a meaningful MAC address
                net.mac && net.mac !== '00:00:00:00:00:00' && 
                net.mac.trim() !== '' &&
                // Exclude interfaces with generic/parsed MAC addresses
                !['name', 'macaddress', 'status', 'linkspeed'].some(
                  keyword => net.mac.toLowerCase().includes(keyword)
                );

              return isValidInterface;
            })
            .map(net => {
              // Find corresponding network stats
              const stats = networkStats.find(stat => stat.iface === net.iface) || {};
              
              // WiFi Network Name Retrieval
              let wifiNetworkName = 'N/A';
              if (net.type === 'wireless') {
                try {
                  const wifiProfileOutput = execSync('netsh wlan show interfaces', { encoding: 'utf8' });
                  const networkNameMatch = wifiProfileOutput.match(/SSID\s*:\s*(.+)/);
                  if (networkNameMatch) {
                    wifiNetworkName = networkNameMatch[1].trim();
                  }
                } catch (wifiNameError) {
                  console.error('WiFi network name retrieval error:', wifiNameError);
                }
              }
              
              // Network Speed Retrieval
              let uploadSpeed = 'N/A';
              let downloadSpeed = 'N/A';
              try {
                // Prefer systeminformation network stats
                if (stats.tx_sec) {
                  uploadSpeed = `${(stats.tx_sec / 1024 / 1024).toFixed(2)} Mbps`;
                }
                if (stats.rx_sec) {
                  downloadSpeed = `${(stats.rx_sec / 1024 / 1024).toFixed(2)} Mbps`;
                }

                // Fallback to PowerShell for speed if systeminformation fails
                if (uploadSpeed === 'N/A' || downloadSpeed === 'N/A') {
                  const powershellCmd = `powershell -Command "Get-NetAdapterStatistics -Name '${net.iface}' | Select-Object SentBytes, ReceivedBytes"`;
                  const networkStatsOutput = execSync(powershellCmd, { encoding: 'utf8' });
                  
                  const sentBytesMatch = networkStatsOutput.match(/SentBytes\s*:\s*(\d+)/);
                  const receivedBytesMatch = networkStatsOutput.match(/ReceivedBytes\s*:\s*(\d+)/);
                  
                  if (sentBytesMatch && receivedBytesMatch) {
                    const sentBytes = parseInt(sentBytesMatch[1]);
                    const receivedBytes = parseInt(receivedBytesMatch[1]);
                    
                    // More accurate speed estimation
                    uploadSpeed = `${(sentBytes / 1024 / 1024 / 10).toFixed(2)} Mbps`;
                    downloadSpeed = `${(receivedBytes / 1024 / 1024 / 10).toFixed(2)} Mbps`;
                  }
                }
              } catch (speedError) {
                console.error('Network speed retrieval error:', speedError);
              }
              
              return {
                name: net.ifaceName || net.iface || 'Unknown Interface',
                type: (net.type || 'Unknown').toUpperCase(),
                ip: net.ip4 || net.ip6 || 'N/A',
                mac: net.mac || 'N/A',
                wifiNetworkName: wifiNetworkName,
                status: {
                  operstate: net.operstate || 'Unknown',
                  carrier: net.operstate === 'up' ? 'Connected' : 'Disconnected'
                }
              };
            });

          return {
            adapters: refinedInterfaces.length > 0 
              ? refinedInterfaces 
              : [{
                  name: 'No Meaningful Network Adapters',
                  type: 'Unknown',
                  ip: 'N/A',
                  mac: 'N/A',
                  wifiNetworkName: 'N/A',
                  status: {
                    carrier: 'Disconnected',
                    operstate: 'Unknown'
                  }
                }],
            connectedAdapter: refinedInterfaces.find(net => net.status.carrier === 'Connected') || null
          };
        } catch (error) {
          console.error('Network information retrieval error:', error);
          return { 
            adapters: [{
              name: 'Network Detection Failed',
              type: 'Unknown',
              ip: 'N/A',
              mac: 'N/A',
              wifiNetworkName: 'N/A',
              status: {
                carrier: 'Error',
                operstate: 'Unknown'
              }
            }],
            connectedAdapter: null,
            error: error.message 
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
          
          // Power Plan retrieval
          let powerPlan = 'Unknown';
          try {
            const { execSync } = require('child_process');
            const powerPlanOutput = execSync('powercfg /getactivescheme', { encoding: 'utf8' });
            const planMatch = powerPlanOutput.match(/Power Scheme GUID: .*\((.*)\)/);
            powerPlan = planMatch ? planMatch[1] : 'Unknown';
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

// Ticket Submission Handler
ipcMain.handle('send-ticket', async (event, ticketData) => {
    console.log(`[send-ticket handler] Invoked at ${new Date().toISOString()}`);
    try {
        // Prepare email content (plain text)
        const emailContent = `Support Ticket Details:\n\nFull Name: ${ticketData.fullName}\nEmail: ${ticketData.email}\nPhone: ${ticketData.phone}\n\nDescription:\n${ticketData.description}\n\nSystem Information:\n${JSON.stringify(ticketData.systemInfo, null, 2)}\n`;

        // Prepare email content (HTML)
        function systemInfoTable(systemInfo) {
            if (!systemInfo) return '<em>No system info available</em>';
            let html = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:8px;">';
            function row(label, value) {
                return `<tr><td style=\"background:#f4f4f4;font-weight:bold;\">${label}</td><td>${value}</td></tr>`;
            }
            html += row('Platform', systemInfo.platform || '');
            html += row('Hostname', systemInfo.hostname || '');
            html += row('Uptime', systemInfo.uptime || '');
            if (systemInfo.cpu) {
                html += row('CPU', `${systemInfo.cpu.model || ''} (${systemInfo.cpu.cores || ''} cores)`);
                html += row('CPU Load', systemInfo.cpu.currentLoad ? systemInfo.cpu.currentLoad.toFixed(1) + '%' : 'N/A');
            }
            if (systemInfo.memory) {
                html += row('Memory', `${(systemInfo.memory.used/1024/1024/1024).toFixed(2)} GB used / ${(systemInfo.memory.total/1024/1024/1024).toFixed(2)} GB total (${systemInfo.memory.usagePercent ? systemInfo.memory.usagePercent.toFixed(1) : '?'}%)`);
            }
            if (systemInfo.disks && Array.isArray(systemInfo.disks) && systemInfo.disks.length > 0) {
                html += `<tr><td style=\"background:#f4f4f4;font-weight:bold;\">Disks</td><td><ul style=\"margin:0;padding-left:15px;\">` +
                    systemInfo.disks.map(d => `<li>${d.mount || ''} (${d.type || ''}): ${(d.used/1024/1024/1024).toFixed(2)} GB used / ${(d.total/1024/1024/1024).toFixed(2)} GB total (${d.usagePercent ? d.usagePercent.toFixed(1) : '?'}%)</li>`).join('') +
                    `</ul></td></tr>`;
            }
            if (systemInfo.network && systemInfo.network.adapters && Array.isArray(systemInfo.network.adapters)) {
                html += `<tr><td style=\"background:#f4f4f4;font-weight:bold;\">Network</td><td><ul style=\"margin:0;padding-left:15px;\">` +
                    systemInfo.network.adapters.map(a => `<li>${a.name || ''} (${a.type || ''}) - IP: ${a.ip || 'N/A'}, MAC: ${a.mac || 'N/A'}, WiFi: ${a.wifiNetworkName || 'N/A'}, Status: ${a.status ? a.status.carrier : 'N/A'}</li>`).join('') +
                    `</ul></td></tr>`;
            }
            if (systemInfo.graphics && Array.isArray(systemInfo.graphics)) {
                html += `<tr><td style=\"background:#f4f4f4;font-weight:bold;\">Graphics</td><td><ul style=\"margin:0;padding-left:15px;\">` +
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
                html += `<tr><td style=\"background:#f4f4f4;font-weight:bold;\">Displays</td><td><ul style=\"margin:0;padding-left:15px;\">` +
                    systemInfo.additionalInfo.display.map(d => `<li>${d.model || 'Unknown'} ${d.main ? '(Main)' : ''} - ${d.resolution || ''}, Depth: ${d.pixelDepth || ''}</li>`).join('') +
                    `</ul></td></tr>`;
            }
            html += '</table>';
            return html;
        }

        const emailHtml = `
            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#222;max-width:700px;margin:auto;">
                <h2 style="background:#2ecc71;color:#fff;padding:12px 18px;border-radius:6px 6px 0 0;margin:0 0 12px 0;">Support Ticket Details</h2>
                <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:15px;width:100%;margin-bottom:18px;">
                    <tr><td style="font-weight:bold;width:140px;">Full Name:</td><td>${ticketData.fullName}</td></tr>
                    <tr><td style="font-weight:bold;">Email:</td><td>${ticketData.email}</td></tr>
                    <tr><td style="font-weight:bold;">Phone:</td><td>${ticketData.phone}</td></tr>
                </table>
                <div style="margin-bottom:18px;padding:10px 14px;background:#f9f9f9;border-left:4px solid #2ecc71;border-radius:4px;">
                    <div style="font-weight:bold;margin-bottom:4px;">Description:</div>
                    <div style="white-space:pre-line;">${ticketData.description}</div>
                </div>
                <div style="margin-bottom:8px;font-weight:bold;">System Information:</div>
                ${systemInfoTable(ticketData.systemInfo)}
            </div>
        `;

        // Send email using nodemailer (existing logic)
        const transporter = nodemailer.createTransport({
          host: 'smtp.dbs-scans.co.za',
          port: 465,
          secure: true, // Use SSL
          auth: {
            user: 'inscaperollout@dbs-scans.co.za',
            pass: 'K619vv4Y39744p'
          },
          tls: {
            // Do not fail on invalid certs
            rejectUnauthorized: false
          }
        });

        const mailOptions = {
          from: 'inscaperollout@dbs-scans.co.za',
          to: 'lionelbakerza@gmail.com',
          subject: `Support Ticket from ${ticketData.fullName}`,
          text: emailContent,
          html: emailHtml,
          replyTo: ticketData.email
        };
        // Only add cc if email is present and valid
        if (ticketData.email && ticketData.email.includes('@')) {
          mailOptions.cc = ticketData.email;
        } else {
          console.log('No valid user email for cc, skipping cc field.');
        }

        console.log('Preparing to send ticket email:', mailOptions);
        const info = await transporter.sendMail(mailOptions);

        console.log('Ticket email sent:', info.messageId);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Ticket submission error:', error);
        return { success: false, error: error.message };
    }
});

// Consolidated TeamViewer launch handler
function setupTeamViewerHandler() {
  // Remove all existing 'launch-teamviewer' handlers
  ipcMain.removeAllListeners('launch-teamviewer');

  // Add new handler
  ipcMain.handle('launch-teamviewer', async (event) => {
    console.log('TeamViewer launch handler called');

    // First, check if TeamViewer is already installed
    if (isTeamViewerInstalled()) {
      try {
        // Try to launch existing TeamViewer installations
        const launchPath = TEAMVIEWER_PATHS.find(path => fs.existsSync(path));
        if (launchPath) {
          console.log(`Launching existing TeamViewer from: ${launchPath}`);
          await openFileOrFolder(launchPath);
          return { success: true, installed: true };
        }
      } catch (error) {
        console.error('Error launching existing TeamViewer:', error);
      }
    }

    // If not installed, download TeamViewer Quick Support
    try {
      console.log('TeamViewer not found, initiating download');
      const downloadPath = await downloadTeamViewerQuickSupport();
      return { 
        success: true, 
        installed: false, 
        downloadPath: downloadPath 
      };
    } catch (error) {
      console.error('TeamViewer download error:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to download TeamViewer Quick Support' 
      };
    }
  });
}

function createWindow() {
  // Setup TeamViewer handler
  setupTeamViewerHandler();

  // Get the primary display
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Widget-like window configuration
  mainWindow = new BrowserWindow({
    width: 350,  // Narrow width for widget-like appearance
    height: 780, // Increased from 600 to 780 (30% increase)
    x: width - 370, // Position 20px from right edge
    y: height - 800, // Adjusted y position to maintain bottom alignment
    frame: false, // Frameless window
    transparent: true, // Allows for custom shaped window
    alwaysOnTop: false, // Sits behind other windows
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    skipTaskbar: true, // Don't show in taskbar
    show: false // Don't show immediately
  });

  // Load the index.html
  mainWindow.loadFile('index.html');

  // Only show when activated
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Bring window to front when clicked
  mainWindow.on('focus', () => {
    mainWindow.setAlwaysOnTop(true);
  });

  // Return to background when focus is lost
  mainWindow.on('blur', () => {
    mainWindow.setAlwaysOnTop(false);
  });

  // Create system tray icon
  tray = new Tray(path.join(__dirname, 'assets/DBS_Logo.png'));
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Restore', 
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      } 
    },
    { 
      label: 'Exit', 
      click: () => {
        app.quit();
      } 
    }
  ]);
  tray.setToolTip('DBS Support Desk');
  tray.setContextMenu(contextMenu);

  // IPC handlers for window controls
  ipcMain.on('minimize-window', () => {
    mainWindow.hide();
  });

  // Optional: Add custom window controls if needed
  mainWindow.on('close', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

// Auto-update functionality
function checkForUpdates() {
  log.info('Checking for updates...');
  
  // Only check for updates in production
  if (process.env.NODE_ENV === 'development') {
    log.info('Skipping update check in development mode');
    return;
  }

  autoUpdater.autoDownload = false; // We'll manually start the download
  autoUpdater.allowPrerelease = false; // Only stable releases
  autoUpdater.allowDowngrade = false; // Don't allow downgrading

  // Check for updates
  autoUpdater.checkForUpdates()
    .then(updateCheckResult => {
      if (updateCheckResult) {
        log.info('Update available:', updateCheckResult.updateInfo.version);
        // Notify renderer that an update is available
        mainWindow.webContents.send('update-available', updateCheckResult.updateInfo);
      } else {
        log.info('No updates available');
      }
    })
    .catch(err => {
      log.error('Error checking for updates:', err);
    });
}

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
  log.info('Checking for update...');  
  mainWindow.webContents.send('update-status', 'Checking for updates...');
});

autoUpdater.on('update-available', (info) => {
  log.info('Update available:', info.version);
  mainWindow.webContents.send('update-available', info);
});

autoUpdater.on('update-not-available', (info) => {
  log.info('No updates available');
  mainWindow.webContents.send('update-not-available');
});

autoUpdater.on('error', (err) => {
  log.error('Error in auto-updater:', err);
  mainWindow.webContents.send('update-error', err.message || 'Error during update');
});

autoUpdater.on('download-progress', (progressObj) => {
  log.info('Download progress:', progressObj);
  mainWindow.webContents.send('download-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
  log.info('Update downloaded, will install in 5 seconds');
  mainWindow.webContents.send('update-downloaded', info);
  
  // Wait 5 seconds before installing to let the user save their work
  setTimeout(() => {
    log.info('Restarting app to install update...');
    autoUpdater.quitAndInstall();
  }, 5000);
});

// IPC handlers for update actions
ipcMain.on('download-update', () => {
  log.info('Starting update download...');
  mainWindow.webContents.send('update-status', 'Starting download...');
  autoUpdater.downloadUpdate();
});

ipcMain.on('install-update', () => {
  log.info('Installing update...');
  mainWindow.webContents.send('update-status', 'Installing update...');
  autoUpdater.quitAndInstall();
});

// Modify app lifecycle to keep app running in background
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Do nothing, keep app running
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.whenReady().then(() => {
  createWindow();
  
  // Check for updates after a short delay to ensure the app is fully loaded
  setTimeout(checkForUpdates, 10000); // 10 seconds delay
  
  // Set up periodic checks (every 4 hours)
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
});
