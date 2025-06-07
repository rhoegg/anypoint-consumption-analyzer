/*
 * Copyright 2025 Ryan Hoegg
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables if present
dotenv.config();

// Base URLs for Anypoint Platform APIs
const ANYPOINT_AUTH_URL = 'https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token';
const ANYPOINT_API_BASE = 'https://anypoint.mulesoft.com';
const ANYPOINT_MONITORING_API = 'https://monitoring.anypoint.mulesoft.com/monitoring/api/v2';

// Configuration variables
const CONFIG = {
  clientId: process.env.ANYPOINT_CLIENT_ID || process.argv[2],
  clientSecret: process.env.ANYPOINT_CLIENT_SECRET || process.argv[3],
  outputDir: 'consumption-data',
  jarsDir: 'application-jars',
  debug: process.env.DEBUG || process.argv[4] === 'debug',
  exportCsv: process.env.EXPORT_CSV !== 'false', // Default to true unless explicitly disabled
  downloadJars: process.env.DOWNLOAD_JARS !== 'false', // Default to true unless explicitly disabled
  analyzeDays: parseInt(process.env.ANALYZE_DAYS || '30', 10) // Default to 30 days
};

// Validate required parameters
if (!CONFIG.clientId || !CONFIG.clientSecret) {
  console.error('Error: Client ID and Client Secret are required.');
  console.error('Usage: node consumption-analyzer.js <clientId> <clientSecret> [debug]');
  process.exit(1);
}

if (CONFIG.debug) {
  console.log('Debug mode enabled. Additional information will be displayed.');
  console.log(`Analyzing data for the last ${CONFIG.analyzeDays} days.`);
  console.log(`JAR downloads: ${CONFIG.downloadJars ? 'Enabled' : 'Disabled'}`);
}

const api = axios.create({
  baseURL: ANYPOINT_API_BASE,
  headers: {
    'Content-Type': 'application/json'
  }
});

const monitoringApi = axios.create({
  baseURL: ANYPOINT_MONITORING_API,
  headers: {
    'Content-Type': 'application/json'
  }
});

/**
 * Get access token for Anypoint Platform API access
 */
async function getAccessToken() {
  try {
    const response = await axios.post(ANYPOINT_AUTH_URL, {
      grant_type: 'client_credentials',
      client_id: CONFIG.clientId,
      client_secret: CONFIG.clientSecret
    });
    
    return response.data.access_token;
  } catch (error) {
    // TODO: Add retry logic for failed API calls
    console.error('Error getting access token:', error.message);
    if (error.response && error.response.data) {
      console.error(error.response.data);
    }
    throw error;
  }
}

/**
 * Get the root organization details
 */
async function getRootOrganization(token) {
  try {
    const response = await api.get('/accounts/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    return {
      id: response.data.user.organizationId,
      name: response.data.user.organization.name
    };
  } catch (error) {
    console.error('Error getting root organization:', error.message);
    throw error;
  }
}

/**
 * Get all business groups within the organization
 */
async function getBusinessGroups(token, orgId) {
  try {
    const response = await api.get(`/accounts/api/organizations/${orgId}/hierarchy`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    // Return flat array of all business groups including the root organization
    return flattenBusinessGroups(response.data);
  } catch (error) {
    console.error('Error getting business groups:', error.message);
    throw error;
  }
}

function flattenBusinessGroups(group) {
  const result = [{
    id: group.id,
    name: group.name,
    parentId: group.parentId || null
  }];
  
  if (group.subOrganizations && group.subOrganizations.length > 0) {
    for (const subOrg of group.subOrganizations) {
      result.push(...flattenBusinessGroups(subOrg));
    }
  }
  
  return result;
}

/**
 * Get all environments for a specific business group
 */
async function getEnvironments(token, orgId) {
  try {
    const response = await api.get(`/accounts/api/organizations/${orgId}/environments`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    return response.data.data.map(env => ({
      id: env.id,
      name: env.name,
      type: env.type,
      isProduction: env.isProduction
    }));
  } catch (error) {
    console.error(`Error getting environments for business group ${orgId}:`, error.message);
    return [];
  }
}

/**
 * Get applications deployed in a specific environment
 */

async function getApplications(token, orgId, envId) {
  try {
    if (CONFIG.debug) {
      console.log(`DEBUG: Fetching applications with:
        - Organization ID: ${orgId}
        - Environment ID: ${envId}
        - URL: ${ANYPOINT_API_BASE}/cloudhub/api/v2/applications`);
    }

    const response = await api.get('/cloudhub/api/v2/applications', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-ANYPNT-ORG-ID': orgId,
        'X-ANYPNT-ENV-ID': envId
      }
    });
    
    if (CONFIG.debug) {
      console.log(`DEBUG: Response status: ${response.status}`);
      console.log(`DEBUG: Response structure:`, Object.keys(response.data));
    }
    
    // Check if response.data exists
    if (!response.data) {
      console.log(`No data in response for environment ${envId}`);
      return [];
    }
    
    // Handle different API response structures 
    // The API might return { data: [] } or directly return an array
    let applications = [];
    
    if (Array.isArray(response.data)) {
      // API returned an array directly
      applications = response.data;
      if (CONFIG.debug) {
        console.log(`DEBUG: API returned array of ${applications.length} applications directly`);
      }
    } else if (response.data.data && Array.isArray(response.data.data)) {
      // API returned { data: [...] } structure
      applications = response.data.data;
      if (CONFIG.debug) {
        console.log(`DEBUG: API returned ${applications.length} applications in data property`);
      }
    } else if (response.data.applications && Array.isArray(response.data.applications)) {
      // API might return { applications: [...] } structure
      applications = response.data.applications;
      if (CONFIG.debug) {
        console.log(`DEBUG: API returned ${applications.length} applications in applications property`);
      }
    } else {
      // No recognizable applications array in the response
      console.log(`No applications data array found for environment ${envId}`);
      
      // Log the actual response structure in debug mode
      if (CONFIG.debug) {
        console.log(`DEBUG: Full response:`, JSON.stringify(response.data, null, 2));
      }
      
      return [];
    }
    
    // Return basic application information
    return applications.map(app => ({
      domain: app.domain,
      status: app.status,
      lastUpdateTime: app.lastUpdateTime,
      fileName: app.fileName || null,
      muleVersion: app.muleVersion || 'Unknown',
      workerSize: app.workers?.type?.weight || 0,
      workerType: app.workers?.type?.name || 'Unknown',
      numberOfWorkers: app.workers?.amount || 0
    }));
  } catch (error) {
    console.error(`Error getting applications for environment ${envId}:`, error.message);
    
    // Log more detailed error information if available
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      if (CONFIG.debug) {
        console.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
      } else {
        console.error(`Response data:`, error.response.data);
      }
    }
    
    return [];
  }
}

/**
 * Get detailed application information including deployment and file data
 */
async function getApplicationDetails(token, orgId, envId, applicationDomain) {
  try {
    if (CONFIG.debug) {
      console.log(`DEBUG: Fetching details for application ${applicationDomain}`);
    }

    const response = await api.get(`/cloudhub/api/v2/applications/${applicationDomain}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-ANYPNT-ORG-ID': orgId,
        'X-ANYPNT-ENV-ID': envId
      }
    });

    if (!response.data) {
      console.log(`No details found for application ${applicationDomain}`);
      return null;
    }
    
    if (CONFIG.debug) {
      console.log(`DEBUG: Application details structure:`, Object.keys(response.data));
    }

    return response.data;
  } catch (error) {
    console.error(`Error getting details for application ${applicationDomain}:`, error.message);
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
    }
    return null;
  }
}

/**
 * Download the application JAR file
 * 
 * Note: This function attempts to download the JAR using the ARM API,
 * but has been observed to return 500 errors. The function will try once
 * and gracefully handle failures, falling back to metadata-based estimation.
 */
async function downloadApplicationJar(token, orgId, envId, appDetails) {
  if (!CONFIG.downloadJars) {
    return null;
  }
  
  // TODO: Implement parallel JAR downloads for better performance
  const domain = appDetails.domain;
  const fileName = appDetails.fileName || `${domain}.jar`;
  
  try {
    if (CONFIG.debug) {
      console.log(`DEBUG: Attempting to download JAR for ${domain}`);
    }
    
    // Check if we have file info in the application details
    if (!appDetails.fileName) {
      console.log(`No file information available for ${domain}. Cannot download JAR.`);
      return null;
    }
    
    // Ensure the download directory exists
    const jarsDirPath = path.join(CONFIG.outputDir, CONFIG.jarsDir);
    ensureDirectoryExists(jarsDirPath);
    
    // Full path where the JAR will be saved
    const jarPath = path.join(jarsDirPath, fileName);
    
    // Check if the file already exists
    if (fs.existsSync(jarPath)) {
      console.log(`JAR file for ${domain} already exists at ${jarPath}`);
      const stats = fs.statSync(jarPath);
      return {
        jarPath,
        downloaded: false,
        size: stats.size
      };
    }
    
    // Use the ARM REST API endpoint: /hybrid/api/v1/applications/{applicationId}/artifact
    console.log(`Attempting to download JAR for ${domain} using ARM REST API`);
    
    // Get the application ID
    // The versionId in the appDetails is the ID we need
    const applicationId = appDetails.versionId;
    
    if (!applicationId) {
      console.log(`No applicationId (versionId) available for ${domain}. Cannot download JAR.`);
      return null;
    }
    
    if (CONFIG.debug) {
      console.log(`DEBUG: Using applicationId: ${applicationId}`);
    }
    
    // Make the API request
    try {
      const armUrl = `/hybrid/api/v1/applications/${applicationId}/artifact`;
      
      if (CONFIG.debug) {
        console.log(`DEBUG: Making GET request to ${ANYPOINT_API_BASE}${armUrl}`);
      }
      
      const response = await api.get(armUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-ANYPNT-ORG-ID': orgId,
          'X-ANYPNT-ENV-ID': envId
        },
        responseType: 'arraybuffer'
      });
      
      if (!response.data) {
        console.log(`No JAR file data received from ARM API for ${domain}`);
        return null;
      }
      
      if (CONFIG.debug) {
        console.log(`DEBUG: Received response: ${response.status}`);
        console.log(`DEBUG: Content-Type: ${response.headers['content-type']}`);
        console.log(`DEBUG: Content-Length: ${response.headers['content-length']}`);
      }
      
      // Save the JAR to disk
      fs.writeFileSync(jarPath, Buffer.from(response.data));
      console.log(`Downloaded JAR file for ${domain} to ${jarPath} using ARM API`);
      
      return {
        jarPath,
        downloaded: true,
        size: response.data.length,
        method: 'arm-api'
      };
    } catch (armError) {
      console.error(`ARM API download failed for ${domain}: ${armError.message}`);
      
      if (armError.response) {
        console.error(`Status: ${armError.response.status}`);
        
        // Only log detailed error information in debug mode
        if (CONFIG.debug) {
          console.error(`Status text: ${armError.response.statusText}`);
          
          // Try to parse error response if it's not binary
          try {
            const errorText = Buffer.from(armError.response.data).toString('utf8');
            console.error('Error response:', errorText.substring(0, 200));
            
            try {
              const errorJson = JSON.parse(errorText);
              console.error('Error details:', JSON.stringify(errorJson, null, 2));
            } catch (e) {
              // Not JSON, that's fine
            }
          } catch (e) {
            console.error('Could not parse error response as text');
          }
        }
      }
      
      // Return null without additional fallbacks
      console.log(`Will use application metadata to estimate flow counts instead.`);
      return null;
    }
  } catch (error) {
    console.error(`Error downloading JAR for application ${domain}:`, error.message);
    return null;
  }
}

/**
 * Get monitoring information for an application
 */
async function getApplicationMonitoringData(token, orgId, envId, applicationDomain) {
  try {
    // Calculate date range for monitoring data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - CONFIG.analyzeDays);
    
    const startTimestamp = startDate.getTime();
    const endTimestamp = endDate.getTime();
    
    if (CONFIG.debug) {
      console.log(`DEBUG: Fetching monitoring data for ${applicationDomain} from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    }

    // Get message count metrics
    let messageData = null;
    try {
      const messageResponse = await monitoringApi.get(`/organizations/${orgId}/environments/${envId}/applications/${applicationDomain}/metrics`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          from: startTimestamp,
          to: endTimestamp,
          metrics: 'messageCount'
        }
      });
      
      if (messageResponse.data && !messageResponse.data.error) {
        messageData = messageResponse.data;
      }
    } catch (error) {
      console.log(`Unable to fetch message count metrics for ${applicationDomain}: ${error.message}`);
    }
    
    // Get CPU/memory metrics as a fallback
    let resourceData = null;
    try {
      const resourceResponse = await monitoringApi.get(`/organizations/${orgId}/environments/${envId}/applications/${applicationDomain}/metrics`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          from: startTimestamp,
          to: endTimestamp,
          metrics: 'cpu,memory'
        }
      });
      
      if (resourceResponse.data && !resourceResponse.data.error) {
        resourceData = resourceResponse.data;
      }
    } catch (error) {
      console.log(`Unable to fetch resource metrics for ${applicationDomain}: ${error.message}`);
    }
    
    // Get flow metrics if available
    let flowMetrics = null;
    try {
      const flowResponse = await monitoringApi.get(`/organizations/${orgId}/environments/${envId}/applications/${applicationDomain}/flows/metrics`, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        params: {
          from: startTimestamp,
          to: endTimestamp
        }
      });
      if (flowResponse.data && !flowResponse.data.error) {
        flowMetrics = flowResponse.data;
      }
    } catch (error) {
      console.log(`Unable to fetch flow metrics for ${applicationDomain}: ${error.message}`);
    }
    
    return {
      messageData,
      resourceData,
      flowMetrics,
      period: {
        from: startDate.toISOString(),
        to: endDate.toISOString(),
        days: CONFIG.analyzeDays
      }
    };
  } catch (error) {
    console.error(`Error getting monitoring data for ${applicationDomain}:`, error.message);
    return null;
  }
}

/**
 * Analyze flow information from JAR file or application metadata
 * 
 * This function tries to analyze a JAR file if available, but can also
 * make educated estimates based on application metadata when the JAR
 * cannot be downloaded or analyzed.
 */
async function analyzeJarForFlows(jarPath, appDetails) {
  // If JAR file is not available, use metadata estimation
  if (!jarPath || !fs.existsSync(jarPath)) {
    console.log(`No JAR file available, using application metadata to estimate flows`);
    return estimateBasedOnAppDetails(appDetails);
  }
  
  try {
    const stats = fs.statSync(jarPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    // Step 1: Try to extract and analyze Mule configuration files from the JAR
    let extractedFlows = null;
    let flowSource = null;
    
    try {
      // Use AdmZip to extract and analyze the JAR
      const { exec } = require('child_process');
      const path = require('path');
      const os = require('os');
      
      // Create a temporary directory for extraction
      const tempDir = path.join(os.tmpdir(), `mule-analysis-${Date.now()}`);
      ensureDirectoryExists(tempDir);
      
      // Extract the JAR file
      console.log(`Extracting JAR file ${jarPath} to ${tempDir} for analysis`);
      
      await new Promise((resolve, reject) => {
        // hack: using shell commands because no good zip library
        const command = `unzip -q "${jarPath}" -d "${tempDir}"`;
        exec(command, (error, stdout, stderr) => {
          if (error && error.code !== 1) { // unzip returns 1 if some files couldn't be extracted
            console.log(`Error extracting JAR: ${error.message}`);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });
      
      // Look for Mule configuration files
      const findMuleConfigsCommand = `find "${tempDir}" -name "*.xml" | grep -v "pom.xml" | xargs grep -l "<mule" || echo "No Mule configs found"`;
      
      const muleConfigFiles = await new Promise((resolve, reject) => {
        exec(findMuleConfigsCommand, (error, stdout, stderr) => {
          if (stdout.trim() === "No Mule configs found") {
            resolve([]);
          } else {
            resolve(stdout.trim().split('\n').filter(f => f));
          }
        });
      });
      
      if (muleConfigFiles.length > 0) {
        console.log(`Found ${muleConfigFiles.length} Mule configuration files`);
        
        // Count flows, sub-flows, and other billable elements in each config file
        let totalFlows = 0;
        let totalSubFlows = 0;
        let totalOtherFlows = 0;
        
        for (const configFile of muleConfigFiles) {
          const grepFlowsCommand = `grep -c "<flow" "${configFile}" || echo 0`;
          const grepSubFlowsCommand = `grep -c "<sub-flow" "${configFile}" || echo 0`;
          const grepOtherFlowsCommand = `grep -c "<\\(batch\\|async\\|until-successful\\|scatter-gather\\)" "${configFile}" || echo 0`;
          
          const flowCount = parseInt(await new Promise((resolve) => {
            exec(grepFlowsCommand, (error, stdout) => resolve(stdout.trim()));
          }), 10);
          
          const subFlowCount = parseInt(await new Promise((resolve) => {
            exec(grepSubFlowsCommand, (error, stdout) => resolve(stdout.trim()));
          }), 10);
          
          const otherFlowCount = parseInt(await new Promise((resolve) => {
            exec(grepOtherFlowsCommand, (error, stdout) => resolve(stdout.trim()));
          }), 10);
          
          totalFlows += flowCount;
          totalSubFlows += subFlowCount;
          totalOtherFlows += otherFlowCount;
        }
        
        extractedFlows = totalFlows + totalSubFlows + totalOtherFlows;
        flowSource = 'XML analysis';
        
        console.log(`Found ${totalFlows} flows, ${totalSubFlows} sub-flows, and ${totalOtherFlows} other flow elements`);
        
        // Clean up the temporary directory
        exec(`rm -rf "${tempDir}"`);
      } else {
        console.log('No Mule configuration files found in JAR');
      }
    } catch (extractError) {
      console.error(`Error extracting/analyzing JAR contents: ${extractError.message}`);
    }
    
    // Step 2: Fall back to heuristic if extraction didn't work
    if (extractedFlows !== null) {
      return {
        estimatedFlows: extractedFlows,
        confidence: 'high',
        source: flowSource,
        size: fileSizeInMB.toFixed(2) + ' MB',
        details: {
          actualAnalysis: true
        }
      };
    } else {
      // Simple heuristic: estimate 1 flow per 0.5 MB of JAR size
      // with a minimum of 1 flow and maximum of 20 flows
      const estimatedFlows = Math.max(1, Math.min(20, Math.round(fileSizeInMB / 0.5)));
      
      return {
        estimatedFlows,
        confidence: 'low',
        source: 'JAR size heuristic',
        size: fileSizeInMB.toFixed(2) + ' MB',
        details: {
          actualAnalysis: false
        }
      };
    }
  } catch (error) {
    console.error(`Error analyzing JAR file ${jarPath}:`, error.message);
    // Fall back to application metadata
    return estimateBasedOnAppDetails(appDetails);
  }
}

function estimateBasedOnAppDetails(appDetails) {
  // Start with a base value
  let estimatedFlows = 2; // Default base assumption
  let confidence = 'low';
  let source = 'Application metadata';
  
  if (!appDetails) {
    return {
      estimatedFlows,
      confidence,
      source: 'Default estimate (no metadata)'
    };
  }
  
  // Try to use the filename to infer complexity
  if (appDetails.fileName) {
    const fileName = appDetails.fileName.toLowerCase();
    
    // Check if it contains terms that suggest complexity
    if (fileName.includes('eapi') || fileName.includes('experience-api')) {
      // Experience APIs tend to have more flows (routing, API implementations)
      estimatedFlows = 5;
      source = 'EAPI filename pattern';
    } else if (fileName.includes('papi') || fileName.includes('process-api')) {
      // Process APIs often have complex orchestration
      estimatedFlows = 7; 
      source = 'PAPI filename pattern';
    } else if (fileName.includes('sapi') || fileName.includes('system-api')) {
      // System APIs can be simpler with fewer flows
      estimatedFlows = 3;
      source = 'SAPI filename pattern';
    }
    
    // Check if it mentions specific integrations that tend to be complex
    if (fileName.includes('salesforce') || fileName.includes('sfdc')) {
      estimatedFlows += 2; // Salesforce integrations often have more logic
      source += ' + Salesforce pattern';
    } else if (fileName.includes('onbase') || fileName.includes('database')) {
      estimatedFlows += 1; // Database integrations often have some complexity
      source += ' + Database pattern';
    } else if (fileName.includes('splunk')) {
      estimatedFlows += 1; // Splunk integrations have some complexity
      source += ' + Splunk pattern';
    }
  } else if (appDetails.domain) {
    // Try to infer from domain name if filename is not available
    const domain = appDetails.domain.toLowerCase();
    
    if (domain.includes('eapi') || domain.includes('experience')) {
      estimatedFlows = 5;
      source = 'EAPI domain pattern';
    } else if (domain.includes('papi') || domain.includes('process')) {
      estimatedFlows = 7;
      source = 'PAPI domain pattern';
    } else if (domain.includes('sapi') || domain.includes('system')) {
      estimatedFlows = 3;
      source = 'SAPI domain pattern';
    }
    
    // Check for integration patterns in domain
    if (domain.includes('salesforce') || domain.includes('sfdc')) {
      estimatedFlows += 2;
      source += ' + Salesforce pattern';
    } else if (domain.includes('onbase') || domain.includes('database')) {
      estimatedFlows += 1;
      source += ' + Database pattern';
    } else if (domain.includes('splunk')) {
      estimatedFlows += 1;
      source += ' + Splunk pattern';
    }
  }
  
  // Use worker count/size as a hint about application complexity
  if (appDetails.workers) {
    if (appDetails.workers.amount > 1) {
      // Multiple workers suggest a more complex or high-volume application
      estimatedFlows += Math.min(3, appDetails.workers.amount - 1);
      source += ' + Multiple workers';
    }
    
    if (appDetails.workers.type && appDetails.workers.type.weight > 0.1) {
      // Larger worker sizes suggest more complex processing
      estimatedFlows += Math.min(3, Math.round(appDetails.workers.type.weight * 10));
      source += ' + Larger worker size';
    }
  }
  
  // Cap to reasonable limits
  estimatedFlows = Math.max(1, Math.min(20, estimatedFlows));
  
  return {
    estimatedFlows,
    confidence,
    source
  };
}

/**
 * Estimate message volume from monitoring data
 */
function estimateMessageVolume(monitoringData) {
  if (!monitoringData) {
    return {
      estimatedDailyMessages: 0,
      estimatedMonthlyMessages: 0,
      confidence: 'none',
      source: 'No monitoring data available'
    };
  }
  
  let estimatedDailyMessages = 0;
  let confidence = 'none';
  let source = 'No message data available';
  
  // Try to extract message counts from flow metrics first (most accurate)
  if (monitoringData.flowMetrics && Array.isArray(monitoringData.flowMetrics)) {
    let totalMessages = 0;
    let flowsWithData = 0;
    
    monitoringData.flowMetrics.forEach(flow => {
      if (flow.messageCount && typeof flow.messageCount.count === 'number') {
        totalMessages += flow.messageCount.count;
        flowsWithData++;
      }
    });
    
    if (flowsWithData > 0) {
      // Calculate average daily messages over the analysis period
      estimatedDailyMessages = totalMessages / monitoringData.period.days;
      confidence = 'high';
      source = 'Flow-level message metrics';
    }
  }
  
  // If no flow metrics, try application-level message count
  if (estimatedDailyMessages === 0 && monitoringData.messageData) {
    const messageData = monitoringData.messageData;
    
    if (messageData.messageCount && typeof messageData.messageCount.count === 'number') {
      estimatedDailyMessages = messageData.messageCount.count / monitoringData.period.days;
      confidence = 'medium';
      source = 'Application-level message metrics';
    }
  }
  
  // If still no message data, make a rough estimate based on resource usage if available
  if (estimatedDailyMessages === 0 && monitoringData.resourceData) {
    const resourceData = monitoringData.resourceData;
    
    if (resourceData.cpu && typeof resourceData.cpu.average === 'number') {
      // Simple heuristic: estimate daily messages based on average CPU usage
      // Higher CPU usage might indicate more message processing
      // This is a rough approximation for demonstration purposes
      const avgCpuPercent = resourceData.cpu.average;
      estimatedDailyMessages = avgCpuPercent * 100; // low volume wild guess
      confidence = 'low';
      source = 'CPU usage heuristic';
    }
  }
  
  // Calculate monthly estimate (average daily × 30)
  const estimatedMonthlyMessages = Math.round(estimatedDailyMessages * 30);
  
  return {
    estimatedDailyMessages: Math.round(estimatedDailyMessages),
    estimatedMonthlyMessages,
    confidence,
    source
  };
}

function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function saveToJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`Saved data to ${filePath}`);
}

/**
 * Generate a CSV file with flow and message usage by application
 */
function generateApplicationCsvReport(inventory) {
  if (!CONFIG.exportCsv) {
    return;
  }
  
  const csvFilePath = path.join(CONFIG.outputDir, 'billable-consumption-by-application.csv');
  
  // CSV header
  let csvContent = 'Business Group,Environment,Is Production,Application,Status,Mule Version,Worker Type,Workers,Estimated Flows,Confidence,Est. Daily Messages,Est. Monthly Messages,Message Confidence,Last Updated\n';
  
  // Process each business group
  inventory.businessGroups.forEach(group => {
    group.environments.forEach(env => {
      const isProduction = env.isProduction ? 'Yes' : 'No';
      
      env.applications.forEach(app => {
        const lastUpdateDate = app.lastUpdateTime ? new Date(app.lastUpdateTime).toISOString().split('T')[0] : 'N/A';
        
        const row = [
          `"${group.name}"`,
          `"${env.name}"`,
          isProduction,
          `"${app.domain}"`,
          `"${app.status || 'Unknown'}"`,
          `"${app.muleVersion || 'Unknown'}"`,
          `"${app.workerType || 'Unknown'}"`,
          app.numberOfWorkers || 0,
          app.flowAnalysis?.estimatedFlows || 0,
          `"${app.flowAnalysis?.confidence || 'none'}"`,
          app.messageAnalysis?.estimatedDailyMessages || 0,
          app.messageAnalysis?.estimatedMonthlyMessages || 0,
          `"${app.messageAnalysis?.confidence || 'none'}"`,
          `"${lastUpdateDate}"`
        ].join(',');
        
        csvContent += row + '\n';
      });
    });
  });
  
  fs.writeFileSync(csvFilePath, csvContent);
}

/**
 * Generate a CSV file with summary by business group
 */
function generateBusinessGroupCsvReport(inventory) {
  if (!CONFIG.exportCsv) {
    return;
  }
  
  const csvFilePath = path.join(CONFIG.outputDir, 'billable-consumption-by-business-group.csv');
  
  // CSV header
  let csvContent = 'Business Group,Business Group ID,Total Applications,Production Apps,Sandbox Apps,Estimated Total Flows,Est. Monthly Messages\n';
  
  // Process each business group
  inventory.businessGroups.forEach(group => {
    let totalApps = 0;
    let totalFlows = 0;
    let totalMonthlyMessages = 0;
    let productionApps = 0;
    let sandboxApps = 0;
    
    group.environments.forEach(env => {
      const apps = env.applications.length;
      totalApps += apps;
      
      if (env.isProduction) {
        productionApps += apps;
      } else {
        sandboxApps += apps;
      }
      
      // Sum up flow and message estimates
      env.applications.forEach(app => {
        totalFlows += app.flowAnalysis?.estimatedFlows || 0;
        totalMonthlyMessages += app.messageAnalysis?.estimatedMonthlyMessages || 0;
      });
    });
    
    const row = [
      `"${group.name}"`,
      `"${group.id}"`,
      totalApps,
      productionApps,
      sandboxApps,
      totalFlows,
      totalMonthlyMessages
    ].join(',');
    
    csvContent += row + '\n';
  });
  
  fs.writeFileSync(csvFilePath, csvContent);
}

/**
 * Generate a CSV file with organization-level summary 
 */
function generateOrganizationSummaryReport(inventory) {
  if (!CONFIG.exportCsv) {
    return;
  }
  
  const csvFilePath = path.join(CONFIG.outputDir, 'organization-consumption-summary.csv');
  
  // Collect organization-wide totals
  let totalApps = 0;
  let productionApps = 0;
  let sandboxApps = 0;
  let totalFlows = 0;
  let productionFlows = 0;
  let sandboxFlows = 0;
  let totalMonthlyMessages = 0;
  let productionMonthlyMessages = 0;
  let sandboxMonthlyMessages = 0;
  
  inventory.businessGroups.forEach(group => {
    group.environments.forEach(env => {
      const isProduction = env.isProduction;
      const apps = env.applications.length;
      
      // Add to application counts
      totalApps += apps;
      if (isProduction) {
        productionApps += apps;
      } else {
        sandboxApps += apps;
      }
      
      // Sum flows and messages by environment type
      env.applications.forEach(app => {
        const flows = app.flowAnalysis?.estimatedFlows || 0;
        const messages = app.messageAnalysis?.estimatedMonthlyMessages || 0;
        
        totalFlows += flows;
        totalMonthlyMessages += messages;
        
        if (isProduction) {
          productionFlows += flows;
          productionMonthlyMessages += messages;
        } else {
          sandboxFlows += flows;
          sandboxMonthlyMessages += messages;
        }
      });
    });
  });
  
  // CSV header
  let csvContent = 'Metric,Total,Production,Sandbox\n';
  
  // Add rows for each metric
  csvContent += `Applications,${totalApps},${productionApps},${sandboxApps}\n`;
  csvContent += `Estimated Flows,${totalFlows},${productionFlows},${sandboxFlows}\n`;
  csvContent += `Est. Monthly Messages,${totalMonthlyMessages},${productionMonthlyMessages},${sandboxMonthlyMessages}\n`;
  
  fs.writeFileSync(csvFilePath, csvContent);
}

/**
 * Main function to analyze billable consumption
 */
async function analyzeBillableConsumption() {
  try {
    console.log('Starting Anypoint Platform billable consumption analysis...');
    
    // Create output directory
    ensureDirectoryExists(CONFIG.outputDir);
    
    // Get access token
    console.log('Authenticating with Anypoint Platform...');
    const token = await getAccessToken();
    
    // Get root organization
    console.log('Getting organization information...');
    const rootOrg = await getRootOrganization(token);
    console.log(`Root Organization: ${rootOrg.name} (${rootOrg.id})`);
    
    // Get all business groups
    console.log('Getting business groups...');
    const businessGroups = await getBusinessGroups(token, rootOrg.id);
    console.log(`Found ${businessGroups.length} business groups`);
    
    // Collect data for each business group and its environments
    const inventory = {
      timestamp: new Date().toISOString(),
      rootOrganization: rootOrg,
      businessGroups: [],
      summary: {
        totalApplications: 0,
        totalEstimatedFlows: 0,
        totalEstimatedMonthlyMessages: 0
      }
    };
    
    for (const group of businessGroups) {
      console.log(`Processing business group: ${group.name} (${group.id})`);
      
      const environments = await getEnvironments(token, group.id);
      console.log(`Found ${environments.length} environments in ${group.name}`);
      
      const businessGroupData = {
        id: group.id,
        name: group.name,
        parentId: group.parentId,
        environments: []
      };
      
      for (const env of environments) {
        console.log(`Processing environment: ${env.name} (${env.id}) in ${group.name}`);
        
        const applications = await getApplications(token, group.id, env.id);
        console.log(`Found ${applications.length} applications in ${env.name}`);
        
        const environmentData = {
          id: env.id,
          name: env.name,
          type: env.type,
          isProduction: env.isProduction,
          applications: []
        };
        
        // Process each application to get detailed information
        for (const app of applications) {
          console.log(`Processing application: ${app.domain} in ${env.name}`);
          
          // Get detailed application information
          const appDetails = await getApplicationDetails(token, group.id, env.id, app.domain);
          
          // Download JAR file if configured
          let jarInfo = null;
          if (CONFIG.downloadJars && appDetails) {
            jarInfo = await downloadApplicationJar(token, group.id, env.id, appDetails);
          }
          
          // Get monitoring data
          const monitoringData = await getApplicationMonitoringData(token, group.id, env.id, app.domain);
          
          // Analyze JAR for flows or estimate based on app metadata
          let flowAnalysis = null;
          if (jarInfo && jarInfo.jarPath) {
            flowAnalysis = await analyzeJarForFlows(jarInfo.jarPath, appDetails);
          } else {
            // No JAR info, use app details for estimation
            flowAnalysis = await analyzeJarForFlows(null, appDetails);
          }
          
          // Estimate message volume
          const messageAnalysis = estimateMessageVolume(monitoringData);
          
          // Combine all information
          const appData = {
            ...app,
            flowAnalysis,
            messageAnalysis,
            jarInfo,
            monitoringData
          };
          
          environmentData.applications.push(appData);
          
          // Update summary totals
          inventory.summary.totalApplications++;
          inventory.summary.totalEstimatedFlows += flowAnalysis.estimatedFlows || 0;
          inventory.summary.totalEstimatedMonthlyMessages += messageAnalysis.estimatedMonthlyMessages || 0;
          
          // Save application data separately
          ensureDirectoryExists(path.join(CONFIG.outputDir, group.id));
          saveToJsonFile(
            path.join(CONFIG.outputDir, group.id, `${app.domain}.json`),
            {
              businessGroup: { id: group.id, name: group.name },
              environment: env,
              application: appData
            }
          );
        }
        
        businessGroupData.environments.push(environmentData);
      }
      
      inventory.businessGroups.push(businessGroupData);
    }
    
    // Save complete inventory
    saveToJsonFile(
      path.join(CONFIG.outputDir, 'complete-billable-consumption.json'),
      inventory
    );
    
    // Generate CSV reports
    if (CONFIG.exportCsv) {
      console.log('Generating CSV reports...');
      generateApplicationCsvReport(inventory);
      generateBusinessGroupCsvReport(inventory);
      generateOrganizationSummaryReport(inventory);
    }
    
    console.log('Billable consumption analysis completed successfully!');
    
    // Print summary
    console.log('\nSummary:');
    console.log(`Total Applications: ${inventory.summary.totalApplications}`);
    console.log(`Total Estimated Flows: ${inventory.summary.totalEstimatedFlows}`);
    console.log(`Total Estimated Monthly Messages: ${inventory.summary.totalEstimatedMonthlyMessages.toLocaleString()}`);
    console.log(`Business Groups: ${inventory.businessGroups.length}`);
    console.log(`Output Directory: ${path.resolve(CONFIG.outputDir)}`);
    if (CONFIG.exportCsv) {
      console.log('CSV Reports:');
      console.log(`  - ${path.resolve(path.join(CONFIG.outputDir, 'billable-consumption-by-application.csv'))}`);
      console.log(`  - ${path.resolve(path.join(CONFIG.outputDir, 'billable-consumption-by-business-group.csv'))}`);
      console.log(`  - ${path.resolve(path.join(CONFIG.outputDir, 'organization-consumption-summary.csv'))}`);
    }
    
  } catch (error) {
    console.error('Error analyzing billable consumption:', error.message);
    process.exit(1);
  }
}

// Run the main function
analyzeBillableConsumption();