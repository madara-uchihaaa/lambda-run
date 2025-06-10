# 🚀 Lambda Run

> **Run AWS Lambda functions locally with smart preferences and flexible test data management**

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue?style=for-the-badge&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=rishabhDMonkey2412.lambda-run)
[![Version](https://img.shields.io/badge/version-1.0.0-green?style=for-the-badge)](https://github.com/madara-uchihaaa/lambda-run)
[![License](https://img.shields.io/badge/license-MIT-orange?style=for-the-badge)](LICENSE)

Transform your AWS Lambda development workflow with **Lambda Run** - the VS Code extension that makes local testing effortless, intelligent, and lightning-fast.

---

## ✨ Features at a Glance

### 🎯 **One-Click Execution**
Execute Lambda functions directly from your YAML files with intuitive CodeLens buttons

### 🧠 **Smart Memory**
Remembers your preferences per function - test files, environments, and regions

### 🔄 **Dual Framework Support**
Works seamlessly with both **SAM** and **Serverless Framework**

### 📁 **Flexible Test Management**
Intelligent test file discovery with customizable search patterns

### 📊 **Execution Tracking**
Complete history of your function runs with detailed statistics

---

## 🚀 Getting Started

### Prerequisites

- **VS Code** 1.93.0 or higher
- **AWS SAM CLI** (for SAM projects) or **Serverless Framework** (for Serverless projects)
- **Node.js** for your Lambda functions

### Installation

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Lambda Run"
4. Click **Install**

### First Run

1. Open a workspace with `template.yaml` (SAM) or `serverless.yml` (Serverless)
2. Look for the **🚀 Run Function** buttons above your function definitions
3. Click to execute - the extension will guide you through the setup!

---

## 🎨 Core Features

### 📋 **CodeLens Integration**

Smart buttons appear directly in your YAML files:

```yaml
functions:
  getUserData:                    # 🚀 Run Function | ⚡ Run (Last Settings)
    handler: src/handlers/user.getUserData
    events:
      - http:
          path: /user/{id}
          method: get
```

- **🚀 Run Function** - Execute with full configuration options
- **⚡ Run (Last Settings)** - Instant re-run with previously used settings

### 🧠 **Intelligent Preferences**

Lambda Run learns and adapts to your workflow:

- **Per-Function Memory**: Remembers test files, environments, and regions for each function
- **Smart Defaults**: Pre-selects your most-used configurations
- **Auto-Cleanup**: Removes invalid preferences when files or configs change

### 🔍 **Smart Test File Discovery**

Multiple discovery strategies for maximum flexibility:

```
📁 my-lambda-project/
├── 📁 test-data/
│   ├── user-create.json     ← Prioritized for 'createUser' function
│   ├── user-update.json     ← Prioritized for 'updateUser' function
│   └── general-test.json
├── 📁 tests/fixtures/
│   └── integration-tests.json
└── 📁 custom-location/
    └── specific-test.json
```

**Configuration Options:**
- **Specific Folders**: Configure exact locations for test files
- **Pattern Matching**: Use glob patterns (`**/*.json`, `**/test-*.json`)
- **Function Priority**: Automatically prioritize test files containing function names
- **Workspace Search**: Fall back to searching entire workspace

### 🌍 **Environment & Region Management**

Flexible configuration management:

**Environments:**
```
Development → PreProd → Prod
```

**AWS Regions:**
```
ap-south-1 (Primary)
us-east-1 (Backup)
eu-west-1 (Global)
```

- Add/remove environments and regions through UI
- Validation prevents empty configurations
- Auto-cleanup of invalid defaults

### 📊 **Execution History & Analytics**

Complete visibility into your development workflow:

```
📈 Execution Statistics:
├── Total Runs: 47
├── Success Rate: 94%
├── Average Duration: 2.3s
└── Most Used: getUserData (12 runs)

📋 Recent History:
├── ✅ getUserData (PreProd, ap-south-1) - 2.1s
├── ✅ createUser (Prod, us-east-1) - 1.8s
├── ❌ updateUser (PreProd, ap-south-1) - Failed
└── ✅ deleteUser (PreProd, ap-south-1) - 2.5s
```

**Features:**
- **Detailed Logging**: Track every execution with timestamps and duration
- **Re-run from History**: Click any history item to execute again
- **Success Tracking**: Monitor which functions are working reliably
- **Export Capabilities**: Copy statistics for reporting

---

## 🎛️ Configuration

### Command Palette Actions

Access all features via `Ctrl+Shift+P`:

- **Lambda Run: Configure Environments** - Manage deployment stages
- **Lambda Run: Configure Regions** - Manage AWS regions
- **Lambda Run: Configure Test Data Locations** - Set up test file directories
- **Lambda Run: Show Execution History** - View and re-run previous executions
- **Lambda Run: Manage Extension Data** - Statistics and data management
- **Lambda Run: Reset Extension to Defaults** - Clean slate reset

### ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+R` | Run function with last settings |
| `Ctrl+Shift+H` | Show execution history |

*Mac users: Replace `Ctrl` with `Cmd`*

### ⚙️ Settings

Fine-tune Lambda Run through VS Code Settings (`Ctrl+,`):

```json
{
  "lambdaRun.environments": ["Dev", "Staging", "Prod"],
  "lambdaRun.regions": ["us-east-1", "eu-west-1"],
  "lambdaRun.testDataLocations": ["test-data", "tests/fixtures"],
  "lambdaRun.rememberPreferences": true,
  "lambdaRun.functionSpecificTestPriority": true,
  "lambdaRun.maxExecutionHistory": 50,
  "lambdaRun.notificationLevel": "info"
}
```

**Key Settings:**
- `testDataLocations` - Folders to search for test files
- `testFilePatterns` - File patterns to match (e.g., `**/*.json`)
- `rememberPreferences` - Save last-used settings per function
- `reuseTerminals` - Reuse terminals vs create new ones
- `autoShowTerminal` - Automatically show terminal during execution

---

## 🔧 Advanced Usage

### Custom Test File Patterns

Configure specific patterns for your test files:

```json
{
  "lambdaRun.testFilePatterns": [
    "**/*-test.json",        // Standard test files
    "**/fixtures/*.json",    // Fixture files
    "**/samples/**.json"     // Sample data
  ]
}
```

### Environment-Specific Variables

Lambda Run automatically detects and uses environment files:

```
📁 your-project/
├── env.json          ← Used for PreProd environment
├── envProd.json      ← Used for Prod environment
└── template.yaml
```

### Terminal Management

Control how terminals are handled:

- **Reuse Terminals**: One terminal per function (efficient)
- **New Terminals**: Fresh terminal for each execution (isolated)
- **Auto-Show**: Automatically bring terminal to focus

---

## 🏗️ Framework Support

### SAM (Serverless Application Model)

**File Structure:**
```yaml
# template.yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  GetUserFunction:              # 🚀 Run Function
    Type: AWS::Serverless::Function
    Properties:
      Handler: src/user.getUser
      Runtime: nodejs18.x
```

**Generated Command:**
```bash
sam local invoke GetUserFunction \
  --template-file template.yaml \
  --event "test-data/user-get.json" \
  --parameter-overrides Stage=PreProd Mode=Update \
  --region ap-south-1 \
  --env-vars env.json
```

### Serverless Framework

**File Structure:**
```yaml
# serverless.yml
service: my-lambda-service

functions:
  getUser:                      # 🚀 Run Function
    handler: src/user.getUser
    events:
      - http:
          path: /user/{id}
          method: get
```

**Generated Command:**
```bash
serverless invoke local \
  --function getUser \
  --path "test-data/user-get.json" \
  --stage PreProd \
  --region ap-south-1 \
  --param 'mode=Update'
```

---

## 📈 Workflow Examples

### Daily Development Workflow

1. **Morning Setup**: Open your Lambda project
2. **Quick Testing**: Use ⚡ Run (Last Settings) for rapid iterations
3. **New Features**: Use 🚀 Run Function to test with different data
4. **Environment Testing**: Switch between PreProd/Prod environments
5. **History Review**: Check `Ctrl+Shift+H` for execution patterns

### Team Collaboration

1. **Shared Config**: Commit `.vscode/settings.json` with team preferences
2. **Test Organization**: Standardize test file locations and patterns
3. **Environment Sync**: Ensure all team members have same environments configured

### CI/CD Integration

While Lambda Run is for local development, it helps prepare for CI/CD:

1. **Test Validation**: Ensure all test files work locally before CI
2. **Environment Parity**: Test with same environments used in CI/CD
3. **Command Generation**: See exact commands that work locally

---

## 🚨 Troubleshooting

### Common Issues

**🔸 "No test files found"**
- Check `lambdaRun.testDataLocations` settings
- Verify test files exist in specified locations
- Try "Configure Test Data Locations" command

**🔸 "Handler not defined"**
- Ensure your YAML has proper `handler` field
- Check function syntax matches SAM or Serverless format

**🔸 "Command failed"**
- Verify SAM CLI or Serverless Framework is installed
- Check terminal output for detailed error messages
- Ensure AWS credentials are configured

### Debug Mode

Enable verbose logging:
```json
{
  "lambdaRun.notificationLevel": "verbose"
}
```

View detailed logs in:
- **Output Panel**: View → Output → "Lambda Run"
- **Developer Tools**: Help → Toggle Developer Tools → Console

---

## 🎯 Best Practices

### 📁 Project Organization

```
📁 my-lambda-project/
├── 📁 src/
│   ├── handlers/
│   └── utils/
├── 📁 test-data/              ← Organized test files
│   ├── user/
│   │   ├── create-user.json
│   │   └── update-user.json
│   └── auth/
│       └── login.json
├── 📁 tests/                  ← Unit tests
├── env.json                   ← PreProd environment variables
├── envProd.json              ← Prod environment variables
├── template.yaml             ← SAM template
└── serverless.yml           ← Serverless config
```

### ⚡ Performance Tips

1. **Enable Preference Memory**: Set `rememberPreferences: true`
2. **Reuse Terminals**: Set `reuseTerminals: true`
3. **Organize Test Files**: Use function-specific naming
4. **Limit History**: Set reasonable `maxExecutionHistory`

### 🔒 Security

- **Environment Files**: Add `env*.json` to `.gitignore`
- **Sensitive Data**: Use AWS Parameter Store for secrets
- **Local Only**: Lambda Run is for local development - not production

---

## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/madara-uchihaaa/lambda-run.git

# Install dependencies
npm install

# Start development
npm run watch

# Package extension
npm run package
```

### Contribution Guidelines

- 🐛 **Bug Reports**: Use GitHub issues with detailed reproduction steps
- 💡 **Feature Requests**: Describe use case and expected behavior
- 🔧 **Pull Requests**: Include tests and update documentation
- 📝 **Documentation**: Help improve examples and guides

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **AWS SAM Team** - For the excellent local development tools
- **Serverless Framework** - For revolutionizing serverless development
- **VS Code Team** - For the amazing extension API
- **Community** - For feedback and feature suggestions

---

## 📞 Support

Need help? Here are your options:

- 📚 **Documentation**: Check this README and in-editor help
- 🐛 **Issues**: [GitHub Issues](https://github.com/madara-uchihaaa/lambda-run/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/madara-uchihaaa/lambda-run/discussions)
- 📧 **Contact**: Create an issue for any questions

---

<div align="center">

**Made with ❤️ for the serverless community**

[⭐ Star on GitHub](https://github.com/madara-uchihaaa/lambda-run) • [📦 VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=rishabhDMonkey2412.lambda-run) • [🐛 Report Bug](https://github.com/madara-uchihaaa/lambda-run/issues)

</div>