# Quick Start Guide

## Prerequisites

1. **Node.js** installed (version 12+)
   ```bash
   node --version  # Should show v12.0.0 or higher
   ```

2. **Anypoint Platform Connected App** with these permissions:
   - View Organization
   - View Environment
   - View Applications
   - Monitoring Center Viewer
   - Runtime Manager Download Application

## Step 1: Setup

Clone and install:
```bash
git clone https://github.com/your-org/anypoint-consumption-analyzer.git
cd anypoint-consumption-analyzer
npm install
```

## Step 2: Configure Credentials

Create a `.env` file:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
ANYPOINT_CLIENT_ID=abc123def456
ANYPOINT_CLIENT_SECRET=ghi789jkl012
```

## Step 3: Run the Analysis

```bash
node consumption-analyzer.js
```

## Step 4: Review Results

Check the `consumption-data` directory:
```bash
ls consumption-data/
```

Open the CSV reports in Excel or Google Sheets:
- `billable-consumption-by-application.csv` - Detailed per-app data
- `organization-consumption-summary.csv` - High-level summary

## Common Commands

### Debug Mode
```bash
DEBUG=true node consumption-analyzer.js
```

### Skip JAR Downloads
```bash
DOWNLOAD_JARS=false node consumption-analyzer.js
```

### Analyze Last 60 Days
```bash
ANALYZE_DAYS=60 node consumption-analyzer.js
```

## Troubleshooting

If you see authentication errors:
- Verify your Connected App credentials
- Ensure the app has the required permissions
- Check if the app is active in Anypoint Platform

If no applications appear:
- Verify environment access permissions
- Check if applications are deployed to CloudHub
- Try debug mode for more details

## Next Steps

- Review the [full documentation](../README.md)
- Analyze the CSV reports for billing insights
- Set up automated runs via cron or CI/CD
- Share reports with stakeholders
