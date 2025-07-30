const { ipcRenderer } = require('electron');

// Ticket Form Submission
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');

    // Get form and critical elements
    const ticketForm = document.getElementById('ticket-form');
    const fullNameInput = document.getElementById('full-name');
    const emailInput = document.getElementById('email');
    const phoneInput = document.getElementById('phone-input');
    const descriptionInput = document.getElementById('description');
    const ticketStatus = document.getElementById('ticket-status');
    const submitButton = ticketForm ? ticketForm.querySelector('button[type="submit"]') : null;

    // Log element existence
    console.log('Critical Elements Check:', {
        ticketForm: !!ticketForm,
        fullNameInput: !!fullNameInput,
        emailInput: !!emailInput,
        phoneInput: !!phoneInput,
        descriptionInput: !!descriptionInput,
        ticketStatus: !!ticketStatus,
        submitButton: !!submitButton
    });

    let isSubmitting = false;

    // --- Modal for sending status ---
    function showSendingModal() {
        let modal = document.getElementById('sending-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'sending-modal';
            modal.style.position = 'fixed';
            modal.style.top = '0';
            modal.style.left = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(0,0,0,0.3)';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            modal.style.zIndex = '2000';
            modal.innerHTML = `
                <div style="background: #fff; padding: 24px 32px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.15); min-width: 300px; text-align: center;">
                    <div style="font-size: 1.2em; margin-bottom: 12px;">Sending ticket...</div>
                    <div class="progress" style="height: 18px; margin-bottom: 4px;">
                        <div class="progress-bar progress-bar-striped progress-bar-animated" style="width: 100%; background: #2ecc71; height: 100%;"></div>
                    </div>
                    <div style="font-size: 0.9em; color: #888;">Please wait</div>
                </div>
            `;
            document.body.appendChild(modal);
        } else {
            modal.style.display = 'flex';
        }
    }
    function hideSendingModal() {
        const modal = document.getElementById('sending-modal');
        if (modal) modal.style.display = 'none';
    }

    // Ticket submission event listener
    const handleTicketSubmission = async (e) => {
        e.preventDefault(); // Prevent default form submission

        try {
            // Validate inputs
            showSendingModal();
            if (!fullNameInput.value.trim()) {
                throw new Error('Please enter your full name');
            }

            if (!emailInput.value.trim() || !emailInput.value.includes('@')) {
                throw new Error('Please enter a valid email address');
            }

            // Prepare ticket data
            const ticketData = {
                fullName: fullNameInput.value.trim(),
                email: emailInput.value.trim(),
                phone: phoneInput.value.trim() || 'Not Provided',
                description: descriptionInput.value.trim(),
                systemInfo: await ipcRenderer.invoke('get-system-info')
            };

            console.log('Ticket Submission Data:', ticketData);

            // Send ticket via IPC
            const result = await ipcRenderer.invoke('send-ticket', ticketData);

            console.log('Ticket submission result:', result);

            if (result.success) {
                hideSendingModal();
                // Confirmation popup
                showTicketConfirmation();
                if (ticketStatus) {
                    ticketStatus.innerHTML = `
                        <div style="color: green; border: 1px solid green; padding: 10px;">
                            <strong>Ticket Submitted Successfully!</strong>
                            <p>A DBS Technology support agent will review your request and revert shortly.</p>
                        </div>`;
                }
                // Reset form
                ticketForm.reset();
                isSubmitting = false;
                if (submitButton) submitButton.disabled = false;
            } else {
                throw new Error(result.message || 'Unable to submit ticket');
            }
        } catch (error) {
            hideSendingModal();
            console.error('Ticket submission error:', error);
            if (ticketStatus) {
                ticketStatus.innerHTML = `
                    <div style="color: red; border: 1px solid red; padding: 10px;">
                        <strong>Error:</strong> ${error.message}
                    </div>`;
            }
            isSubmitting = false;
            if (submitButton) submitButton.disabled = false;
        }
    };

    // Add event listener to form (once, robust)
    if (ticketForm) {
        ticketForm.addEventListener('submit', handleTicketSubmission);
    } else {
        console.error('Ticket form not found');
    }
});

// Phone Number Formatting Function
function formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = phoneNumber.replace(/\D/g, '');
    
    // Check if the number is 10 digits long and starts with 0
    if (cleaned.length === 10 && cleaned.startsWith('0')) {
        // Explicitly format as (082) 564-0943
        return `(0${cleaned.slice(1, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    
    // If the number doesn't match expected format, return original input
    return phoneNumber;
}

// Phone number input element
const phoneInput = document.getElementById('phone-input');

// Add event listener for real-time formatting
phoneInput.addEventListener('input', (e) => {
    console.log('Phone Input Debug:', {
        phoneInputElement: phoneInput,
        phoneInputValue: phoneInput.value,
        phoneInputValueTrimmed: phoneInput.value.trim(),
        phoneInputType: typeof phoneInput.value,
        phoneInputLength: phoneInput.value.length
    });

    // Store current cursor position
    const start = e.target.selectionStart;
    const end = e.target.selectionEnd;

    // Format the input
    e.target.value = formatPhoneNumber(e.target.value);

    // Restore cursor position
    e.target.setSelectionRange(start, end);
});

// TeamViewer Button
const teamviewerBtn = document.getElementById('teamviewer-btn');
const teamviewerStatus = document.getElementById('teamviewer-status');

let isProcessing = false; // Flag to prevent multiple simultaneous calls

// TeamViewer Status Confirmation
function showTeamViewerStatus(message, type = 'success') {
    // Remove any existing status messages
    const existingStatus = document.getElementById('teamviewer-status-modal');
    if (existingStatus) {
        document.body.removeChild(existingStatus);
    }

    // Create status container
    const statusContainer = document.createElement('div');
    statusContainer.id = 'teamviewer-status-modal';
    statusContainer.className = `ticket-confirmation alert alert-${type} text-center`;
    
    // Determine icon and message based on type
    const icon = type === 'success' ? '✅' : '❌';
    
    statusContainer.innerHTML = `
        <strong>${icon} TeamViewer Status</strong>
        <p>${message}</p>
        <button id="teamviewer-status-ok" class="btn btn-primary mt-2">OK</button>
    `;
    
    // Style the status message (same as ticket confirmation)
    statusContainer.style.position = 'fixed';
    statusContainer.style.top = '50%';
    statusContainer.style.left = '50%';
    statusContainer.style.transform = 'translate(-50%, -50%)';
    statusContainer.style.zIndex = '1000';
    statusContainer.style.width = '90%';
    statusContainer.style.maxWidth = '400px';
    statusContainer.style.padding = '20px';
    statusContainer.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    
    // Add to document body
    document.body.appendChild(statusContainer);
    
    // Add event listener for OK button
    const okButton = document.getElementById('teamviewer-status-ok');
    okButton.addEventListener('click', () => {
        document.body.removeChild(statusContainer);
    });
}

teamviewerBtn.addEventListener('click', async () => {
    // Prevent multiple simultaneous clicks
    if (isProcessing) {
        console.log('TeamViewer process already in progress');
        return;
    }

    try {
        // Set processing flag
        isProcessing = true;

        // Disable button
        teamviewerBtn.disabled = true;

        // Invoke TeamViewer launch/download
        const result = await ipcRenderer.invoke('launch-teamviewer');
        console.log('TeamViewer launch result:', result);

        if (result.success) {
            if (result.installed) {
                // TeamViewer was already installed and launched
                showTeamViewerStatus('TeamViewer launched successfully');
            } else {
                // TeamViewer Quick Support downloaded and launched
                showTeamViewerStatus('TeamViewer Quick Support downloaded and installed');
            }
        } else {
            // Error during launch/download
            console.error('TeamViewer launch error:', result.error);
            showTeamViewerStatus(result.error || 'Failed to launch TeamViewer', 'danger');
        }
    } catch (error) {
        // Unexpected error
        console.error('Unexpected TeamViewer launch error:', error);
        showTeamViewerStatus('Unexpected error occurred', 'danger');
    } finally {
        // Re-enable button and reset processing flag
        teamviewerBtn.disabled = false;
        isProcessing = false;
    }
});

// Function to update system performance metrics
async function updateSystemPerformanceMetrics() {
    try {
        const systemInfo = await ipcRenderer.invoke('get-system-info');
        
        // Disk Space
        const diskUsage = systemInfo.disks[0] || { total: 1, used: 0, usagePercent: 0 };
        const diskUsedPercentage = Math.round((diskUsage.used / diskUsage.total) * 100);
        const diskProgressBar = document.getElementById('disk-progress');
        const diskText = document.getElementById('disk-text');
        diskProgressBar.style.width = `${diskUsedPercentage}%`;
        diskProgressBar.className = `progress-bar ${
            diskUsedPercentage < 50 ? 'bg-success' : 
            diskUsedPercentage < 70 ? 'bg-warning' : 'bg-danger'
        }`;
        diskText.textContent = `${diskUsedPercentage}% (${(diskUsage.used / (1024 * 1024 * 1024)).toFixed(2)}GB / ${(diskUsage.total / (1024 * 1024 * 1024)).toFixed(2)}GB)`;

        // Memory
        const memoryUsage = systemInfo.memory;
        const memoryUsedPercentage = Math.round((memoryUsage.used / memoryUsage.total) * 100);
        const memoryProgressBar = document.getElementById('memory-progress');
        const memoryText = document.getElementById('memory-text');
        memoryProgressBar.style.width = `${memoryUsedPercentage}%`;
        memoryProgressBar.className = `progress-bar ${
            memoryUsedPercentage < 50 ? 'bg-success' : 
            memoryUsedPercentage < 70 ? 'bg-warning' : 'bg-danger'
        }`;
        memoryText.textContent = `${memoryUsedPercentage}% (${(memoryUsage.used / (1024 * 1024 * 1024)).toFixed(2)}GB / ${(memoryUsage.total / (1024 * 1024 * 1024)).toFixed(2)}GB)`;

        // CPU
        const cpuUsage = systemInfo.cpu.currentLoad;
        const cpuProgressBar = document.getElementById('cpu-progress');
        const cpuText = document.getElementById('cpu-text');
        cpuProgressBar.style.width = `${cpuUsage}%`;
        cpuProgressBar.className = `progress-bar ${
            cpuUsage < 50 ? 'bg-success' : 
            cpuUsage < 70 ? 'bg-warning' : 'bg-danger'
        }`;
        cpuText.textContent = `${Math.round(cpuUsage)}%`;
    } catch (error) {
        console.error('Error updating system performance metrics:', error);
        
        // Fallback to show error state
        ['disk', 'memory', 'cpu'].forEach(metric => {
            const progressBar = document.getElementById(`${metric}-progress`);
            const textElement = document.getElementById(`${metric}-text`);
            if (progressBar && textElement) {
                progressBar.style.width = '0%';
                progressBar.className = 'progress-bar bg-danger';
                textElement.textContent = 'Error retrieving data';
            }
        });
    }
}

// Ensure progress bars are initialized on page load
document.addEventListener('DOMContentLoaded', () => {
    ['disk', 'memory', 'cpu'].forEach(metric => {
        const progressBar = document.getElementById(`${metric}-progress`);
        const textElement = document.getElementById(`${metric}-text`);
        if (progressBar && textElement) {
            progressBar.style.width = '0%';
            progressBar.className = 'progress-bar bg-secondary';
            textElement.textContent = 'Initializing...';
        }
    });

    // Update metrics every 120 seconds (2 minutes)
    setInterval(updateSystemPerformanceMetrics, 120000);

    // Initial update
    updateSystemPerformanceMetrics();
});

// Widget Performance Monitoring
function monitorWidgetPerformance() {
    // Check memory usage
    if (window.performance && window.performance.memory) {
        const memory = window.performance.memory;
        console.group('Widget Memory Usage');
        console.log('Total JS Heap Size:', (memory.totalJSHeapSize / 1024 / 1024).toFixed(2) + ' MB');
        console.log('Used JS Heap Size:', (memory.usedJSHeapSize / 1024 / 1024).toFixed(2) + ' MB');
        console.log('JS Heap Size Limit:', (memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2) + ' MB');
        console.groupEnd();
    }

    // Performance timing
    const performanceEntries = performance.getEntriesByType('measure');
    if (performanceEntries.length > 0) {
        console.group('Widget Performance Measures');
        performanceEntries.forEach(entry => {
            console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
        });
        console.groupEnd();
    }

    // Check rendering performance
    requestAnimationFrame(() => {
        const start = performance.now();
        // Simulate a render check
        document.getElementById('disk-progress').style.width = '50%';
        const end = performance.now();
        console.log('Render Update Time:', (end - start).toFixed(2) + 'ms');
    });
}

// Add performance monitoring to system metrics update
const originalUpdateMetrics = updateSystemPerformanceMetrics;
updateSystemPerformanceMetrics = async function() {
    performance.mark('metricsUpdateStart');
    await originalUpdateMetrics();
    performance.mark('metricsUpdateEnd');
    performance.measure('Metrics Update', 'metricsUpdateStart', 'metricsUpdateEnd');
    
    monitorWidgetPerformance();
}

// Initial performance snapshot
document.addEventListener('DOMContentLoaded', () => {
    // Log initial widget load performance
    if (window.performance) {
        const loadTimes = window.performance.timing;
        console.group('Widget Load Performance');
        console.log('Total Load Time:', (loadTimes.loadEventEnd - loadTimes.navigationStart) + 'ms');
        console.log('DOM Load Time:', (loadTimes.domComplete - loadTimes.domLoading) + 'ms');
        console.groupEnd();
    }
});

// Ticket Submission Confirmation
function showTicketConfirmation() {
    // Create confirmation container
    const confirmationContainer = document.createElement('div');
    confirmationContainer.className = 'ticket-confirmation alert alert-success text-center';
    confirmationContainer.innerHTML = `
        <strong>Ticket Submitted Successfully!</strong>
        <p>Your ticket has been submitted to DBS Technology. Our team will review it shortly. Thank you for reaching out!</p>
        <button id="ticket-confirmation-ok" class="btn btn-primary mt-2">OK</button>
    `;
    
    // Style the confirmation message
    confirmationContainer.style.position = 'fixed';
    confirmationContainer.style.top = '50%';
    confirmationContainer.style.left = '50%';
    confirmationContainer.style.transform = 'translate(-50%, -50%)';
    confirmationContainer.style.zIndex = '1000';
    confirmationContainer.style.width = '90%';
    confirmationContainer.style.maxWidth = '400px';
    confirmationContainer.style.padding = '20px';
    confirmationContainer.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    
    // Add to document body
    document.body.appendChild(confirmationContainer);
    
    // Add event listener for OK button
    const okButton = document.getElementById('ticket-confirmation-ok');
    okButton.addEventListener('click', () => {
        document.body.removeChild(confirmationContainer);
    });
}

// Modify ticket submission handler

// Auto-update UI elements and handlers
let updateAvailable = false;
let updateInfo = null;
let updateDownloading = false;

// Create update notification element
const updateNotification = document.createElement('div');
updateNotification.id = 'update-notification';
updateNotification.style.display = 'none';
updateNotification.style.position = 'fixed';
updateNotification.style.bottom = '20px';
updateNotification.style.right = '20px';
updateNotification.style.backgroundColor = '#2c3e50';
updateNotification.style.color = 'white';
updateNotification.style.padding = '15px';
updateNotification.style.borderRadius = '5px';
updateNotification.style.zIndex = '1000';
updateNotification.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
updateNotification.style.maxWidth = '300px';

document.body.appendChild(updateNotification);

// Handle update available
ipcRenderer.on('update-available', (event, info) => {
  updateAvailable = true;
  updateInfo = info;
  
  updateNotification.innerHTML = `
    <h3 style="margin: 0 0 10px 0; color: #3498db;">Update Available!</h3>
    <p style="margin: 0 0 10px 0;">Version ${info.version} is available. Would you like to download and install it now?</p>
    <button id="download-update" style="background: #3498db; color: white; border: none; padding: 5px 10px; border-radius: 3px; margin-right: 5px; cursor: pointer;">Download Update</button>
    <button id="remind-later" style="background: #7f8c8d; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Remind Me Later</button>
  `;
  
  updateNotification.style.display = 'block';
  
  document.getElementById('download-update').addEventListener('click', () => {
    ipcRenderer.send('download-update');
    updateDownloading = true;
    updateNotification.innerHTML = `
      <h3 style="margin: 0 0 10px 0; color: #3498db;">Downloading Update...</h3>
      <div style="background: #2c3e50; height: 20px; border-radius: 10px; overflow: hidden; margin: 10px 0;">
        <div id="download-progress-bar" style="background: #3498db; height: 100%; width: 0%; transition: width 0.3s;"></div>
      </div>
      <p id="download-status" style="margin: 5px 0 0 0; font-size: 0.9em;">Preparing download...</p>
    `;
  });
  
  document.getElementById('remind-later').addEventListener('click', () => {
    updateNotification.style.display = 'none';
    // Show the notification again in 1 hour
    setTimeout(() => {
      if (updateAvailable) {
        updateNotification.style.display = 'block';
      }
    }, 60 * 60 * 1000);
  });
});

// Handle download progress
ipcRenderer.on('download-progress', (event, progressObj) => {
  if (!updateDownloading) return;
  
  const percent = Math.round(progressObj.percent || 0);
  const mbps = progressObj.bytesPerSecond ? (progressObj.bytesPerSecond / (1024 * 1024)).toFixed(2) : 0;
  
  const progressBar = document.getElementById('download-progress-bar');
  const statusText = document.getElementById('download-status');
  
  if (progressBar) progressBar.style.width = `${percent}%`;
  if (statusText) statusText.textContent = `Downloading: ${percent}% (${mbps} MB/s)`;
});

// Handle update downloaded
ipcRenderer.on('update-downloaded', () => {
  updateNotification.innerHTML = `
    <h3 style="margin: 0 0 10px 0; color: #2ecc71;">Update Ready to Install</h3>
    <p style="margin: 0 0 10px 0;">The update has been downloaded. The application will restart to install the update in 5 seconds.</p>
    <button id="restart-now" style="background: #2ecc71; color: white; border: none; padding: 5px 10px; border-radius: 3px; cursor: pointer;">Restart Now</button>
  `;
  
  document.getElementById('restart-now').addEventListener('click', () => {
    ipcRenderer.send('install-update');
  });
});

// Add styles for the update notification
const style = document.createElement('style');
style.textContent = `
  #update-notification button {
    transition: background-color 0.2s;
  }
  #update-notification button:hover {
    opacity: 0.9;
  }
  #update-notification button:active {
    transform: translateY(1px);
  }
`;
document.head.appendChild(style);
