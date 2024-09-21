# Lambda Runner - VSCode Extension

This VSCode extension provides a simple way to invoke AWS Lambda functions defined in both `template.yaml` (SAM) and `serverless.yml` (Serverless Framework) files directly from the editor. The extension adds CodeLens options to invoke local Lambda functions with pre-configured test files, environment variables, and runtime parameters.

## Features

- **Automatic Function Detection:** 
  - The extension detects AWS Lambda functions defined in either `template.yaml` or `serverless.yml`.
  - For each detected function, a **CodeLens** ("Run This Function") is displayed above the function definition.
  
- **Dynamic Test File Selection:** 
  - The extension looks for test files (JSON format) in a `test-data` folder in the root of the workspace.
  - Users are prompted to select a test file to simulate an event for the Lambda function.

- **Environment Selection:**
  - Users can choose between different environments (e.g., `Preprod` or `Prod`).
  
- **Region Input:**
  - The extension prompts users to input the AWS region where the function will be invoked. Default region is set to `ap-south-1`.

- **Environment Variables Management:**
  - The extension looks for `env.json` and `envProd.json` files in the workspace for configuring environment-specific variables during invocation.

- **SAM and Serverless Framework Support:**
  - Supports both the AWS SAM CLI (`sam local invoke`) and the Serverless Framework (`serverless invoke local`) for local function invocations.
  
- **Command Execution in Terminal:**
  - All commands are executed in a new VSCode terminal, allowing users to see the output of the Lambda function execution in real-time.

## How It Works

1. **Detecting Functions:**
   - The extension uses regular expressions to detect functions in `template.yaml` and `serverless.yml`.

     - **For SAM (`template.yaml`) files:**
       - Functions are identified by the `Type: AWS::Serverless::Function` and their associated handler.
       - **Regex:** `(\w+):\s*Type:\s*AWS::Serverless::Function\s*Properties:\s*Handler:\s*([^\s]+)`
         - This captures two groups:
           1. The function name (first capture group: `(\w+)`).
           2. The handler (second capture group: `([^\s]+)`).

       - **Example Function Definition:**
         ```yaml
         MyFunction:
           Type: AWS::Serverless::Function
           Properties:
             Handler: index.handler
             ...
         ```

     - **For Serverless (`serverless.yml`) files:**
       - Functions are identified by the `functions` key and the corresponding handler.
       - **Regex:** `(\w+):\s*handler:\s*([^\s]+)`
         - This captures two groups:
           1. The function name (first capture group: `(\w+)`).
           2. The handler (second capture group: `([^\s]+)`).

       - **Example Function Definition:**
         ```yaml
         functions:
           myFunction:
             handler: index.handler
             ...
         ```

   - For each detected function, the extension checks if the handler is defined. If the handler is valid, a **CodeLens** with the option to "Run This Function" is displayed above the function definition.

2. **CodeLens Options:**
   - After detecting a function, the extension adds a **CodeLens** above the function, showing:
     - "Run This Function" if the function has a valid handler.
     - "Handler Not Defined" if the handler is missing or undefined.
   
3. **Running Functions:**
   - When you click the **CodeLens** to run a function:
     1. **Test File Selection:** You are prompted to select a test file from the `test-data` folder (only `.json` files are displayed).
     2. **Environment Selection:** You are prompted to choose the environment (`Preprod` or `Prod`).
     3. **Region Input:** You are asked to enter the AWS region (default is `ap-south-1`).
     4. **Environment Variables:** Depending on the selected environment, the extension looks for `env.json` or `envProd.json` files in the workspace.
     5. **Command Execution:** The selected SAM/Serverless function is executed with the selected test file, environment, and region via the terminal.

## Assumptions

- **Test Files:** 
  - The extension assumes that all test files are in JSON format and are located in the `test-data` folder at the root of the workspace.
  - If the folder does not exist, the extension will create it automatically and ask you to add test files.
  
- **Environment Variables Files:**
  - The extension expects `env.json` for Preprod and `envProd.json` for Prod, located at the root of the workspace. If these files do not exist, it will fall back to `env.json`.

## When Do Options Appear?

- **Run This Function (CodeLens):**
  - This option appears above any function definition in `template.yaml` or `serverless.yml`.
  - The option only appears if the function has a valid handler defined.

- **Test File Selection:**
  - This option appears once you initiate the function invocation. It will list all `.json` test files from the `test-data` folder for you to choose from.

- **Environment Selection:**
  - After selecting a test file, you will be prompted to choose the environment (`Preprod` or `Prod`).

- **Region Input:**
  - After selecting the environment, you will be prompted to enter the AWS region for the Lambda function execution.

## Prerequisites

- **AWS SAM CLI** if you are using SAM templates (`template.yaml`).
- **Serverless Framework CLI** if you are using Serverless Framework (`serverless.yml`).
- A `test-data` folder with test event JSON files.
- Optional: `env.json` and `envProd.json` for environment-specific variables.

## Installation

1. Clone or download the extension.
2. Open the folder in VSCode.
3. Run the extension in a development environment using `F5` in VSCode.

## Usage

1. Open a workspace that includes a `template.yaml` or `serverless.yml` file.
2. Add a `test-data` folder at the root of the workspace and add JSON files representing the test events.
3. Open any `template.yaml` or `serverless.yml` file.
4. A **CodeLens** will appear above the Lambda function declarations with the option to "Run This Function".
5. Click the CodeLens to initiate the function invocation process.

## Contributing

Feel free to submit issues and pull requests for new features or bug fixes.
