# Anypoint Consumption Analyzer

A Node.js tool for analyzing MuleSoft Anypoint Platform deployments to estimate billable flows and message consumption across organizations.

## Overview

Analyzes MuleSoft Anypoint Platform deployments to estimate billable flows and message consumption. Tracks flow counts, monitors message volume, provides usage insights across business groups, and separates production vs. sandbox consumption patterns.

## Features

### Core Capabilities
- Downloads and analyzes application JAR files to count actual flows
- Falls back to metadata-based estimation when JARs are unavailable
- Collects message metrics from Anypoint Monitoring
- Generates consumption reports in multiple formats

### Analysis Methods

The tool tries three approaches: First, it analyzes JAR files directly by extracting and parsing Mule configuration XML to count flows. If JARs aren't available, it estimates based on application metadata like API types (EAPI/PAPI/SAPI) and integration patterns. For message tracking, it uses flow-level metrics when available, falls back to application metrics, or uses CPU-based estimates as a last resort.

### Report Generation
- CSV exports for easy data analysis
- JSON files for programmatic access
- Organized by application, environment, and business group
- Organization-wide summary statistics

## Requirements

- **Node.js**: Version 12 or higher
- **Anypoint Platform Access**: Connected App with appropriate permissions

### Required Permissions

Your Connected App must have the following scopes:
- View Organization
- View Environment  
- View Applications
- Monitoring Center Viewer (for message metrics)
- Runtime Manager Download Application (for JAR analysis)

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/your-org/anypoint-consumption-analyzer.git
   cd anypoint-consumption-analyzer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your credentials (see Configuration section)

## Configuration

### Method 1: Command Line Arguments

```bash
node consumption-analyzer.js <clientId> <clientSecret> [debug]
```

Example:
```bash
node consumption-analyzer.js abc123 xyz789 debug
```

### Method 2: Environment Variables

Create a `.env` file (see `.env.example`):

```env
ANYPOINT_CLIENT_ID=your-client-id
ANYPOINT_CLIENT_SECRET=your-client-secret
DEBUG=true
EXPORT_CSV=true
DOWNLOAD_JARS=true
ANALYZE_DAYS=30
```

Then run:
```bash
node consumption-analyzer.js
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `ANYPOINT_CLIENT_ID` | - | Connected App client ID (required) |
| `ANYPOINT_CLIENT_SECRET` | - | Connected App client secret (required) |
| `DEBUG` | false | Enable detailed logging |
| `EXPORT_CSV` | true | Generate CSV reports |
| `DOWNLOAD_JARS` | true | Attempt to download JAR files for analysis |
| `ANALYZE_DAYS` | 30 | Number of days of monitoring data to analyze |

## Usage

### Basic Usage

Run the analyzer with your credentials:

```bash
node consumption-analyzer.js your-client-id your-client-secret
```

### Debug Mode

For detailed logging and troubleshooting:

```bash
node consumption-analyzer.js your-client-id your-client-secret debug
```

### Disable JAR Downloads

If you only want metadata-based analysis:

```bash
DOWNLOAD_JARS=false node consumption-analyzer.js
```

### Custom Analysis Period

To analyze the last 60 days instead of 30:

```bash
ANALYZE_DAYS=60 node consumption-analyzer.js
```

## Output

The analyzer creates a `consumption-data` directory containing:

### Directory Structure
```
consumption-data/
├── complete-billable-consumption.json      # Full inventory data
├── billable-consumption-by-application.csv # Detailed app report
├── billable-consumption-by-business-group.csv # BG summary
├── organization-consumption-summary.csv    # Org-wide summary
└── [business-group-id]/                   # Per-BG data
    └── [application-name].json            # Individual app details
```

### CSV Reports

1. **Application Report** (`billable-consumption-by-application.csv`)
   - Business Group, Environment, Application details
   - Flow estimates with confidence levels
   - Message volume statistics
   - Worker configuration

2. **Business Group Summary** (`billable-consumption-by-business-group.csv`)
   - Total applications per BG
   - Production vs. Sandbox breakdown
   - Aggregate flow and message counts

3. **Organization Summary** (`organization-consumption-summary.csv`)
   - Organization-wide totals
   - Production vs. Sandbox metrics
   - Total estimated flows and messages

### JSON Data

Complete structured data including:
- Detailed application metadata
- Monitoring metrics
- Flow analysis results
- JAR download status

## Understanding the Results

Flow confidence levels indicate the source: high means JAR analysis, medium means metadata patterns, low means defaults. Message confidence depends on available metrics: high for flow-level data, medium for app-level, low for CPU-based estimates.

The analyzer recognizes patterns like API types (EAPI typically has 5 flows, PAPI 7, SAPI 3) and adjusts for integrations (Salesforce adds 2 flows, database or Splunk add 1 each). Multiple workers or larger sizes suggest more complexity.

## Troubleshooting

### Authentication Issues

```
Error getting access token: Request failed with status code 401
```
- Verify your client ID and secret
- Ensure the Connected App is active
- Check organization access permissions

### Missing Applications

Some applications might not appear if:
- They're deployed outside CloudHub (e.g., Runtime Fabric)
- The Connected App lacks environment access
- Applications are in inactive states

### JAR Download Failures

The ARM API may return 500 errors for JAR downloads. This is expected behavior. The analyzer will log the failure and fall back to metadata-based estimation.

### No Monitoring Data

If message counts show as 0:
- Verify Monitoring Center Viewer permission
- Check if monitoring is enabled for the applications
- Some applications may not report metrics

## Limitations

Applications on Runtime Fabric aren't analyzed. Support for hybrid/on-premise deployments is limited. JAR downloads through the API frequently fail with 500 errors, though manual downloads work fine. Not all applications provide monitoring data, and flow counts are estimates for billing guidance rather than exact numbers.

## Advanced Usage

### Custom Output Directory

Modify the `CONFIG.outputDir` in the source code to change the output location.

### Filtering Business Groups

The tool processes all business groups by default. To filter, modify the business group loop in the main function.

### Integration with CI/CD

Example Jenkins pipeline step:
```groovy
stage('Analyze Consumption') {
    steps {
        sh 'npm install'
        sh 'node consumption-analyzer.js $CLIENT_ID $CLIENT_SECRET'
        archiveArtifacts 'consumption-data/**/*'
    }
}
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

Apache License 2.0 - see LICENSE file for details

## Support

For issues, questions, or contributions:
- Open an issue on GitHub
- Submit a pull request with improvements
- Contact the maintainers

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.