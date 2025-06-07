# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] - 2025-01-06

### Changed
- License changed from MIT to Apache 2.0
- Author updated to Ryan Hoegg

## [1.0.0] - 2025-01-01

### Added
- Initial release of Anypoint Consumption Analyzer
- JAR file analysis for accurate flow counting
- Metadata-based flow estimation as fallback
- Message volume tracking from Anypoint Monitoring
- CSV report generation for different organizational levels
- Support for multiple business groups and environments
- Configurable analysis period (default 30 days)
- Debug mode for troubleshooting
- Environment variable configuration support

### Features
- Analyzes CloudHub applications across entire organizations
- Estimates billable flows using multiple methods:
  - XML parsing of Mule configuration files (highest accuracy)
  - Application metadata patterns (medium accuracy)
  - Size-based heuristics (lowest accuracy)
- Tracks message consumption with confidence levels
- Generates comprehensive reports in CSV and JSON formats
- Handles API limitations gracefully with intelligent fallbacks

### Known Issues
- JAR download API frequently returns 500 errors (fallback to metadata estimation works)
- Limited support for Runtime Fabric deployments
- Monitoring data may not be available for all applications
