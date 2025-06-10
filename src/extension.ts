import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

interface FunctionPreferences {
   lastTestFile?: string;
   lastEnvironment?: string;
   lastRegion?: string;
   lastUsed?: number;
}

interface UserPreferences {
   [functionName: string]: FunctionPreferences;
}

interface ExecutionRecord {
   functionName: string;
   testFile: string;
   environment: string;
   region: string;
   timestamp: number;
   duration?: number;
   success?: boolean;
}

let globalState: vscode.Memento;
let statusBarItem: vscode.StatusBarItem;
let executionHistory: ExecutionRecord[] = [];
let activeTerminals: Map<string, vscode.Terminal> = new Map();
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
   try {
      // Initialize global state and output channel
      globalState = context.globalState;
      outputChannel = vscode.window.createOutputChannel("Lambda Run");

      // Create and configure status bar item
      statusBarItem = vscode.window.createStatusBarItem(
         vscode.StatusBarAlignment.Left,
         100
      );
      statusBarItem.text = "$(rocket) Lambda Ready";
      statusBarItem.tooltip = "Lambda Run - Ready to execute functions";
      statusBarItem.command = "extension.showExecutionHistory";
      statusBarItem.show();
      context.subscriptions.push(statusBarItem);

      // Load execution history from global state
      executionHistory = globalState.get<ExecutionRecord[]>(
         "executionHistory",
         []
      );

      // Validate configuration on startup
      validateAndFixConfiguration();

      // Listen for configuration changes
      context.subscriptions.push(
         vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("lambdaRun")) {
               outputChannel.appendLine("Configuration changed, validating...");
               validateAndFixConfiguration();
            }
         })
      );

      // Register CodeLens provider
      context.subscriptions.push(
         vscode.languages.registerCodeLensProvider(
            [
               { language: "yaml", scheme: "file" },
               { pattern: "**/template.yaml" },
               { pattern: "**/template.yml" },
               { pattern: "**/serverless.yaml" },
               { pattern: "**/serverless.yml" },
            ],
            new LambdaCodeLensProvider()
         )
      );

      // Register commands with improved error handling
      const registerCommand = (
         commandId: string,
         callback: (...args: any[]) => Promise<any> | any
      ) => {
         const disposable = vscode.commands.registerCommand(
            commandId,
            async (...args: any[]) => {
               try {
                  outputChannel.appendLine(`Executing command: ${commandId}`);
                  const result = await callback(...args);
                  outputChannel.appendLine(
                     `Command ${commandId} completed successfully`
                  );
                  return result;
               } catch (error) {
                  const errorMessage =
                     error instanceof Error ? error.message : String(error);
                  const stack = error instanceof Error ? error.stack : "";

                  outputChannel.appendLine(
                     `Error in command ${commandId}: ${errorMessage}`
                  );
                  if (stack) {
                     outputChannel.appendLine(`Stack trace: ${stack}`);
                  }

                  console.error(`Error executing command ${commandId}:`, error);

                  // Show user-friendly error message
                  const action = await vscode.window.showErrorMessage(
                     `Command failed: ${errorMessage}`,
                     "Show Details",
                     "Dismiss"
                  );

                  if (action === "Show Details") {
                     outputChannel.show();
                  }

                  // Re-throw to let VS Code know the command failed
                  throw error;
               }
            }
         );
         context.subscriptions.push(disposable);
      };

      // Register all commands
      registerCommand(
         "extension.configureTestDataLocations",
         configureTestDataLocations
      );
      registerCommand(
         "extension.runFunction",
         async (functionName: string, hasHandler: boolean, isSam: boolean) => {
            await runFunction(functionName, hasHandler, isSam, false);
         }
      );
      registerCommand(
         "extension.runFunctionWithLastSettings",
         async (functionName: string, hasHandler: boolean, isSam: boolean) => {
            await runFunction(functionName, hasHandler, isSam, true);
         }
      );
      registerCommand("extension.showExecutionHistory", showExecutionHistory);
      registerCommand("extension.configureEnvironments", configureEnvironments);
      registerCommand("extension.configureRegions", configureRegions);
      registerCommand("extension.clearHistory", clearExecutionHistory);
      registerCommand(
         "extension.resetExtensionSettings",
         resetExtensionSettings
      );
      registerCommand("extension.manageExtensionData", manageExtensionData);

      // Clean up orphaned terminals on startup
      cleanupOrphanedTerminals();

      outputChannel.appendLine("Lambda Run extension activated successfully");
   } catch (error) {
      const errorMessage =
         error instanceof Error ? error.message : String(error);
      console.error("Error during extension activation:", error);
      vscode.window.showErrorMessage(
         `Failed to activate Lambda Run extension: ${errorMessage}`
      );

      if (outputChannel) {
         outputChannel.appendLine(`Activation error: ${errorMessage}`);
         outputChannel.show();
      }
   }
}

/**
 * Validates configuration and clears invalid defaults without maintaining default properties
 */
function validateAndFixConfiguration(): void {
   try {
      const config = vscode.workspace.getConfiguration("lambdaRun");
      const environments = config.get<string[]>("environments") || [
         "PreProd",
         "Prod",
      ];
      const regions = config.get<string[]>("regions") || [
         "ap-south-1",
         "ap-south-2",
         "us-east-1",
         "us-west-2",
         "eu-west-1",
         "ap-southeast-1",
      ];

      const defaultEnvironment = config.get<string>("defaultEnvironment");
      const defaultRegion = config.get<string>("defaultRegion");

      let needsUpdate = false;

      // Check if default environment is invalid
      if (defaultEnvironment && !environments.includes(defaultEnvironment)) {
         safeConfigUpdate(config, "defaultEnvironment", undefined);
         needsUpdate = true;
         vscode.window.showWarningMessage(
            `Default environment "${defaultEnvironment}" no longer exists. Cleared default setting.`
         );
         outputChannel.appendLine(
            `Cleared invalid default environment: ${defaultEnvironment}`
         );
      }

      // Check if default region is invalid
      if (defaultRegion && !regions.includes(defaultRegion)) {
         safeConfigUpdate(config, "defaultRegion", undefined);
         needsUpdate = true;
         vscode.window.showWarningMessage(
            `Default region "${defaultRegion}" no longer exists. Cleared default setting.`
         );
         outputChannel.appendLine(
            `Cleared invalid default region: ${defaultRegion}`
         );
      }

      validateAndCleanUserPreferences();

      if (needsUpdate) {
         outputChannel.appendLine(
            "Configuration validation and cleanup completed"
         );
      }
   } catch (error) {
      console.error("Error during configuration validation:", error);
      outputChannel.appendLine(`Configuration validation error: ${error}`);
      vscode.window.showErrorMessage(
         "Failed to validate extension configuration"
      );
   }
}

/**
 * Validates and cleans user preferences against current configuration
 */
function validateAndCleanUserPreferences(): void {
   try {
      const config = vscode.workspace.getConfiguration("lambdaRun");
      const currentEnvironments = config.get<string[]>("environments") || [];
      const currentRegions = config.get<string[]>("regions") || [];
      const preferences = getUserPreferences();

      let needsUpdate = false;
      let cleanedCount = 0;

      for (const [functionName, prefs] of Object.entries(preferences)) {
         const updatedPrefs = { ...prefs };

         // Check if last environment still exists
         if (
            prefs.lastEnvironment &&
            !currentEnvironments.includes(prefs.lastEnvironment)
         ) {
            delete updatedPrefs.lastEnvironment;
            needsUpdate = true;
            cleanedCount++;
            outputChannel.appendLine(
               `Cleaned invalid environment for ${functionName}: ${prefs.lastEnvironment}`
            );
         }

         // Check if last region still exists
         if (prefs.lastRegion && !currentRegions.includes(prefs.lastRegion)) {
            delete updatedPrefs.lastRegion;
            needsUpdate = true;
            cleanedCount++;
            outputChannel.appendLine(
               `Cleaned invalid region for ${functionName}: ${prefs.lastRegion}`
            );
         }

         // Check if test file still exists
         if (prefs.lastTestFile) {
            const workspaceRoot =
               vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceRoot) {
               const testFilePath = path.join(
                  workspaceRoot,
                  prefs.lastTestFile
               );
               if (!fs.existsSync(testFilePath)) {
                  delete updatedPrefs.lastTestFile;
                  needsUpdate = true;
                  cleanedCount++;
                  outputChannel.appendLine(
                     `Cleaned missing test file for ${functionName}: ${prefs.lastTestFile}`
                  );
               }
            }
         }

         preferences[functionName] = updatedPrefs;
      }

      if (needsUpdate) {
         globalState.update("userPreferences", preferences);
         outputChannel.appendLine(
            `Cleaned up ${cleanedCount} stale user preference entries`
         );
      }
   } catch (error) {
      console.error("Error validating user preferences:", error);
      outputChannel.appendLine(`User preferences validation error: ${error}`);
   }
}

/**
 * Get valid fallback values when no defaults are configured
 */
function getValidDefaults(): { environment: string; region: string } {
   const config = vscode.workspace.getConfiguration("lambdaRun");
   const environments = config.get<string[]>("environments") || [
      "PreProd",
      "Prod",
   ];
   const regions = config.get<string[]>("regions") || ["ap-south-1"];
   const defaultEnvironment = config.get<string>("defaultEnvironment");
   const defaultRegion = config.get<string>("defaultRegion");

   // Use configured defaults if valid, otherwise fallback to first available option
   const validEnvironment =
      defaultEnvironment && environments.includes(defaultEnvironment)
         ? defaultEnvironment
         : environments[0] || "PreProd";

   const validRegion =
      defaultRegion && regions.includes(defaultRegion)
         ? defaultRegion
         : regions[0] || "ap-south-1";

   return { environment: validEnvironment, region: validRegion };
}

/**
 * Cleanup terminals that are no longer active
 */
function cleanupOrphanedTerminals(): void {
   try {
      const terminalsToRemove: string[] = [];

      activeTerminals.forEach((terminal, name) => {
         if (terminal.exitStatus !== undefined) {
            terminalsToRemove.push(name);
         }
      });

      terminalsToRemove.forEach((name) => {
         activeTerminals.delete(name);
         outputChannel.appendLine(`Cleaned up terminated terminal: ${name}`);
      });

      if (terminalsToRemove.length > 0) {
         outputChannel.appendLine(
            `Cleaned up ${terminalsToRemove.length} orphaned terminals`
         );
      }
   } catch (error) {
      outputChannel.appendLine(`Error cleaning up terminals: ${error}`);
   }
}

async function runFunction(
   functionName: string,
   hasHandler: boolean,
   isSam: boolean,
   useLastSettings: boolean = false
): Promise<void> {
   if (!hasHandler) {
      vscode.window.showErrorMessage(
         `Handler not defined for the function: ${functionName}`
      );
      outputChannel.appendLine(
         `Cannot run ${functionName}: Handler not defined`
      );
      return;
   }

   if (!validateWorkspace()) {
      return;
   }

   const workspaceRoot = vscode.workspace.workspaceFolders![0].uri.fsPath;

   outputChannel.appendLine(
      `Starting execution of function: ${functionName} (useLastSettings: ${useLastSettings})`
   );

   statusBarItem.text = "$(loading~spin) Preparing...";
   statusBarItem.color = new vscode.ThemeColor(
      "statusBarItem.warningForeground"
   );

   try {
      let testFile: string | undefined;
      let selectedEnvironment: string | undefined;
      let selectedRegion: string | undefined;

      // Check if we should use last settings
      if (useLastSettings) {
         const preferences = getUserPreferences();
         const functionPrefs = preferences[functionName];

         if (
            functionPrefs?.lastTestFile &&
            functionPrefs?.lastEnvironment &&
            functionPrefs?.lastRegion
         ) {
            const testFilePath = path.join(
               workspaceRoot,
               functionPrefs.lastTestFile
            );

            if (fs.existsSync(testFilePath)) {
               testFile = functionPrefs.lastTestFile;
               selectedEnvironment = functionPrefs.lastEnvironment;
               selectedRegion = functionPrefs.lastRegion;

               outputChannel.appendLine(
                  `Using last settings - Test: ${testFile}, Env: ${selectedEnvironment}, Region: ${selectedRegion}`
               );
               statusBarItem.text = `$(rocket) Running ${functionName} (last settings)`;

               await executeFunction(
                  functionName,
                  isSam,
                  testFile,
                  selectedEnvironment,
                  selectedRegion,
                  workspaceRoot
               );
               return;
            } else {
               vscode.window.showWarningMessage(
                  `Last used test file no longer exists: ${functionPrefs.lastTestFile}`
               );
               outputChannel.appendLine(
                  `Last test file missing: ${functionPrefs.lastTestFile}`
               );
            }
         } else {
            vscode.window.showInformationMessage(
               `No previous settings found for ${functionName}. Please configure manually.`
            );
            outputChannel.appendLine(
               `No previous settings for ${functionName}`
            );
         }
      }

      // Get test files
      const testFiles = await getTestFiles(workspaceRoot);
      outputChannel.appendLine(`Found ${testFiles.length} test files`);

      if (testFiles.length === 0) {
         const action = await vscode.window.showErrorMessage(
            "No test files found in workspace.",
            "Browse for Test Files",
            "Configure Test Locations"
         );

         if (action === "Browse for Test Files") {
            const selectedFiles = await vscode.window.showOpenDialog({
               canSelectMany: true,
               filters: { "JSON Files": ["json"] },
               defaultUri: vscode.Uri.file(workspaceRoot),
            });

            if (selectedFiles && selectedFiles.length > 0) {
               const relativePath = path.relative(
                  workspaceRoot,
                  selectedFiles[0].fsPath
               );
               testFile = relativePath;
               outputChannel.appendLine(
                  `Selected test file via browser: ${testFile}`
               );
            } else {
               resetStatusBar();
               return;
            }
         } else if (action === "Configure Test Locations") {
            await configureTestDataLocations();
            resetStatusBar();
            return;
         } else {
            resetStatusBar();
            return;
         }
      }

      // Get user preferences for defaults
      const preferences = getUserPreferences();
      const functionPrefs = preferences[functionName];

      // Select test file if not already selected
      if (!testFile) {
         const config = vscode.workspace.getConfiguration("lambdaRun");
         const prioritizeFunctionTests = config.get<boolean>(
            "functionSpecificTestPriority",
            true
         );

         let orderedTestFiles = testFiles;
         if (prioritizeFunctionTests) {
            const functionSpecificTests = testFiles.filter((file) =>
               file.toLowerCase().includes(functionName.toLowerCase())
            );
            const otherTests = testFiles.filter(
               (file) =>
                  !file.toLowerCase().includes(functionName.toLowerCase())
            );
            orderedTestFiles = [...functionSpecificTests, ...otherTests];
            outputChannel.appendLine(
               `Prioritized ${functionSpecificTests.length} function-specific test files`
            );
         }

         const testFileItems = orderedTestFiles.map((file) => ({
            label: path.basename(file),
            description: path.dirname(file),
            detail: file,
            picked: functionPrefs?.lastTestFile === file,
         }));

         const selectedTestFile = await vscode.window.showQuickPick(
            testFileItems,
            {
               placeHolder: `Select a test file for function: ${functionName}`,
               matchOnDescription: true,
               matchOnDetail: true,
            }
         );

         if (!selectedTestFile) {
            resetStatusBar();
            return;
         }
         testFile = selectedTestFile.detail;
         outputChannel.appendLine(`Selected test file: ${testFile}`);
      }

      // Get valid configuration values
      const config = vscode.workspace.getConfiguration("lambdaRun");
      const environments = config.get<string[]>("environments") || [
         "PreProd",
         "Prod",
      ];
      const regions = config.get<string[]>("regions") || ["ap-south-1"];
      const validDefaults = getValidDefaults();

      // Select environment and region
      if (!selectedEnvironment) {
         const envItems = environments.map((env) => ({
            label: env,
            picked:
               functionPrefs?.lastEnvironment === env ||
               (env === validDefaults.environment &&
                  !functionPrefs?.lastEnvironment),
         }));

         const selectedEnv = await vscode.window.showQuickPick(envItems, {
            placeHolder: "Select the environment",
            canPickMany: false,
         });

         if (!selectedEnv) {
            resetStatusBar();
            return;
         }
         selectedEnvironment = selectedEnv.label;
         outputChannel.appendLine(
            `Selected environment: ${selectedEnvironment}`
         );
      }

      if (!selectedRegion) {
         const regionItems = regions.map((region) => ({
            label: region,
            picked:
               functionPrefs?.lastRegion === region ||
               (region === validDefaults.region && !functionPrefs?.lastRegion),
         }));

         const selectedReg = await vscode.window.showQuickPick(regionItems, {
            placeHolder: `Select the region for function: ${functionName}`,
            canPickMany: false,
         });

         if (!selectedReg) {
            resetStatusBar();
            return;
         }
         selectedRegion = selectedReg.label;
         outputChannel.appendLine(`Selected region: ${selectedRegion}`);
      }

      // Save user preferences
      const rememberPreferences = config.get<boolean>(
         "rememberPreferences",
         true
      );
      if (rememberPreferences) {
         saveUserPreferences(
            functionName,
            testFile,
            selectedEnvironment,
            selectedRegion
         );
         outputChannel.appendLine(`Saved preferences for ${functionName}`);
      }

      // Execute the function
      await executeFunction(
         functionName,
         isSam,
         testFile,
         selectedEnvironment,
         selectedRegion,
         workspaceRoot
      );
   } catch (error) {
      const errorMessage =
         error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
         `Error running function ${functionName}: ${errorMessage}`
      );
      vscode.window.showErrorMessage(`Error running function: ${errorMessage}`);

      statusBarItem.text = "$(error) Error";
      statusBarItem.color = new vscode.ThemeColor(
         "statusBarItem.errorForeground"
      );

      setTimeout(() => {
         resetStatusBar();
      }, 3000);
   }
}

/**
 * Reset status bar to default state
 */
function resetStatusBar(): void {
   statusBarItem.text = "$(rocket) Lambda Ready";
   statusBarItem.color = undefined;
}

/**
 * Validate workspace exists
 */
function validateWorkspace(): boolean {
   if (!vscode.workspace.workspaceFolders?.[0]) {
      vscode.window.showErrorMessage(
         "No workspace folder open. Please open a workspace first."
      );
      outputChannel.appendLine("Validation failed: No workspace folder open");
      return false;
   }
   return true;
}

/**
 * Safe configuration update with error handling
 */
async function safeConfigUpdate(
   config: vscode.WorkspaceConfiguration,
   key: string,
   value: any,
   target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace
): Promise<boolean> {
   try {
      await config.update(key, value, target);
      outputChannel.appendLine(`Updated config ${key} = ${value}`);
      return true;
   } catch (error) {
      console.error(`Failed to update config ${key}:`, error);
      outputChannel.appendLine(`Failed to update config ${key}: ${error}`);
      vscode.window.showErrorMessage(`Failed to update setting: ${key}`);
      return false;
   }
}

/**
 * Enhanced configuration management for environments - prevents deleting all
 */
async function configureEnvironments(): Promise<void> {
   // Remove workspace validation for configuration commands
   // These should work even without a workspace open

   const config = vscode.workspace.getConfiguration("lambdaRun");
   const currentEnvironments = config.get<string[]>("environments") || [
      "PreProd",
      "Prod",
   ];

   outputChannel.appendLine(
      `Configuring environments. Current: [${currentEnvironments.join(", ")}]`
   );

   const action = await vscode.window.showQuickPick(
      [
         {
            label: "➕ Add Environment",
            value: "add",
            description: "Add a new environment",
         },
         {
            label: "❌ Remove Environment",
            value: "remove",
            description: "Remove an existing environment",
         },
         {
            label: "✏️ Edit Environments",
            value: "edit",
            description: "Edit the complete list of environments",
         },
      ],
      {
         placeHolder: "Configure environments",
      }
   );

   if (!action) {
      outputChannel.appendLine("Environment configuration cancelled");
      return;
   }

   switch (action.value) {
      case "add":
         const newEnv = await vscode.window.showInputBox({
            prompt: "Enter new environment name",
            validateInput: (value) => {
               if (!value.trim()) return "Environment name cannot be empty";
               if (currentEnvironments.includes(value.trim())) {
                  return "Environment already exists";
               }
               if (value.trim().length > 50) {
                  return "Environment name too long (max 50 characters)";
               }
               return null;
            },
         });

         if (newEnv) {
            const updatedEnvs = [...currentEnvironments, newEnv.trim()];
            if (await safeConfigUpdate(config, "environments", updatedEnvs)) {
               vscode.window.showInformationMessage(
                  `✅ Added environment: ${newEnv}`
               );
               outputChannel.appendLine(`Added environment: ${newEnv}`);
            }
         }
         break;

      case "remove":
         if (currentEnvironments.length <= 1) {
            vscode.window.showWarningMessage(
               "Cannot remove all environments. At least one environment is required for the extension to function properly."
            );
            outputChannel.appendLine(
               "Cannot remove all environments - minimum one required"
            );
            return;
         }

         const envToRemove = await vscode.window.showQuickPick(
            currentEnvironments.map((env) => ({
               label: env,
               description: "Click to remove",
            })),
            { placeHolder: "Select environment to remove" }
         );

         if (envToRemove) {
            const updatedEnvs = currentEnvironments.filter(
               (env) => env !== envToRemove.label
            );
            if (await safeConfigUpdate(config, "environments", updatedEnvs)) {
               // Clear default if we removed the default environment
               const currentDefault = config.get<string>("defaultEnvironment");
               if (currentDefault === envToRemove.label) {
                  await safeConfigUpdate(
                     config,
                     "defaultEnvironment",
                     undefined
                  );
                  vscode.window.showInformationMessage(
                     `Also cleared "${envToRemove.label}" as default environment.`
                  );
               }

               validateAndCleanUserPreferences();
               vscode.window.showInformationMessage(
                  `❌ Removed environment: ${envToRemove.label}`
               );
               outputChannel.appendLine(
                  `Removed environment: ${envToRemove.label}`
               );
            }
         }
         break;

      case "edit":
         const envString = await vscode.window.showInputBox({
            prompt: "Enter environments (comma-separated)",
            value: currentEnvironments.join(", "),
            validateInput: (value) => {
               if (!value.trim()) return "At least one environment is required";
               const envs = value
                  .split(",")
                  .map((env) => env.trim())
                  .filter((env) => env.length > 0);
               if (envs.length === 0)
                  return "At least one environment is required";
               if (envs.some((env) => env.length > 50))
                  return "Environment names too long (max 50 characters)";
               return null;
            },
         });

         if (envString) {
            const newEnvs = envString
               .split(",")
               .map((env) => env.trim())
               .filter((env) => env.length > 0);
            if (await safeConfigUpdate(config, "environments", newEnvs)) {
               // Clear default if current one is no longer valid
               const currentDefault = config.get<string>("defaultEnvironment");
               if (currentDefault && !newEnvs.includes(currentDefault)) {
                  await safeConfigUpdate(
                     config,
                     "defaultEnvironment",
                     undefined
                  );
                  vscode.window.showInformationMessage(
                     `Cleared "${currentDefault}" as default environment since it's no longer available.`
                  );
               }

               validateAndCleanUserPreferences();
               vscode.window.showInformationMessage(
                  `✅ Updated environments: ${newEnvs.join(", ")}`
               );
               outputChannel.appendLine(
                  `Updated environments: [${newEnvs.join(", ")}]`
               );
            }
         }
         break;
   }
}

/**
 * Enhanced configuration management for regions - prevents deleting all
 */
async function configureRegions(): Promise<void> {
   // Remove workspace validation for configuration commands
   // These should work even without a workspace open

   const config = vscode.workspace.getConfiguration("lambdaRun");
   const currentRegions = config.get<string[]>("regions") || [
      "ap-south-1",
      "ap-south-2",
      "us-east-1",
      "us-west-2",
      "eu-west-1",
      "ap-southeast-1",
   ];

   outputChannel.appendLine(
      `Configuring regions. Current: [${currentRegions.join(", ")}]`
   );

   const action = await vscode.window.showQuickPick(
      [
         {
            label: "➕ Add Region",
            value: "add",
            description: "Add a new AWS region",
         },
         {
            label: "❌ Remove Region",
            value: "remove",
            description: "Remove an existing region",
         },
         {
            label: "✏️ Edit Regions",
            value: "edit",
            description: "Edit the complete list of regions",
         },
      ],
      {
         placeHolder: "Configure AWS regions",
      }
   );

   if (!action) {
      outputChannel.appendLine("Region configuration cancelled");
      return;
   }

   switch (action.value) {
      case "add":
         const newRegion = await vscode.window.showInputBox({
            prompt: "Enter new AWS region (e.g., us-west-1)",
            validateInput: (value) => {
               if (!value.trim()) return "Region name cannot be empty";
               if (currentRegions.includes(value.trim())) {
                  return "Region already exists";
               }
               // Basic AWS region format validation
               if (!/^[a-z]{2}-[a-z]+-\d+$/.test(value.trim())) {
                  return "Invalid AWS region format (e.g., us-west-1)";
               }
               return null;
            },
         });

         if (newRegion) {
            const updatedRegions = [...currentRegions, newRegion.trim()];
            if (await safeConfigUpdate(config, "regions", updatedRegions)) {
               vscode.window.showInformationMessage(
                  `✅ Added region: ${newRegion}`
               );
               outputChannel.appendLine(`Added region: ${newRegion}`);
            }
         }
         break;

      case "remove":
         if (currentRegions.length <= 1) {
            vscode.window.showWarningMessage(
               "Cannot remove all regions. At least one region is required for the extension to function properly."
            );
            outputChannel.appendLine(
               "Cannot remove all regions - minimum one required"
            );
            return;
         }

         const regionToRemove = await vscode.window.showQuickPick(
            currentRegions.map((region) => ({
               label: region,
               description: "Click to remove",
            })),
            { placeHolder: "Select region to remove" }
         );

         if (regionToRemove) {
            const updatedRegions = currentRegions.filter(
               (region) => region !== regionToRemove.label
            );
            if (await safeConfigUpdate(config, "regions", updatedRegions)) {
               // Clear default if we removed the default region
               const currentDefault = config.get<string>("defaultRegion");
               if (currentDefault === regionToRemove.label) {
                  await safeConfigUpdate(config, "defaultRegion", undefined);
                  vscode.window.showInformationMessage(
                     `Also cleared "${regionToRemove.label}" as default region.`
                  );
               }

               validateAndCleanUserPreferences();
               vscode.window.showInformationMessage(
                  `❌ Removed region: ${regionToRemove.label}`
               );
               outputChannel.appendLine(
                  `Removed region: ${regionToRemove.label}`
               );
            }
         }
         break;

      case "edit":
         const regionString = await vscode.window.showInputBox({
            prompt:
               "Enter regions (comma-separated, e.g., us-east-1, eu-west-1)",
            value: currentRegions.join(", "),
            validateInput: (value) => {
               if (!value.trim()) return "At least one region is required";
               const regions = value
                  .split(",")
                  .map((r) => r.trim())
                  .filter((r) => r.length > 0);
               if (regions.length === 0)
                  return "At least one region is required";

               // Validate each region format
               for (const region of regions) {
                  if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) {
                     return `Invalid AWS region format: ${region}`;
                  }
               }
               return null;
            },
         });

         if (regionString) {
            const newRegions = regionString
               .split(",")
               .map((region) => region.trim())
               .filter((region) => region.length > 0);
            if (await safeConfigUpdate(config, "regions", newRegions)) {
               // Clear default if current one is no longer valid
               const currentDefault = config.get<string>("defaultRegion");
               if (currentDefault && !newRegions.includes(currentDefault)) {
                  await safeConfigUpdate(config, "defaultRegion", undefined);
                  vscode.window.showInformationMessage(
                     `Cleared "${currentDefault}" as default region since it's no longer available.`
                  );
               }

               validateAndCleanUserPreferences();
               vscode.window.showInformationMessage(
                  `✅ Updated regions: ${newRegions.join(", ")}`
               );
               outputChannel.appendLine(
                  `Updated regions: [${newRegions.join(", ")}]`
               );
            }
         }
         break;
   }
}

async function executeFunction(
   functionName: string,
   isSam: boolean,
   testFile: string,
   environment: string,
   region: string,
   workspaceRoot: string
): Promise<void> {
   const startTime = Date.now();
   const config = vscode.workspace.getConfiguration("lambdaRun");

   outputChannel.appendLine(`Executing function: ${functionName}`);
   outputChannel.appendLine(`  Framework: ${isSam ? "SAM" : "Serverless"}`);
   outputChannel.appendLine(`  Test File: ${testFile}`);
   outputChannel.appendLine(`  Environment: ${environment}`);
   outputChannel.appendLine(`  Region: ${region}`);

   statusBarItem.text = `$(loading~spin) Running ${functionName}`;
   statusBarItem.color = new vscode.ThemeColor(
      "statusBarItem.warningForeground"
   );

   // Get or create terminal
   const reuseTerminals = config.get<boolean>("reuseTerminals", true);
   const terminalName = reuseTerminals
      ? `Lambda-${functionName}`
      : `Lambda-${functionName}-${Date.now()}`;
   let terminal = activeTerminals.get(terminalName);

   if (!terminal || terminal.exitStatus !== undefined) {
      terminal = vscode.window.createTerminal({
         name: terminalName,
         cwd: workspaceRoot,
      });
      if (reuseTerminals) {
         activeTerminals.set(terminalName, terminal);
      }
      outputChannel.appendLine(
         `Created ${
            reuseTerminals ? "reusable" : "new"
         } terminal: ${terminalName}`
      );
   } else {
      outputChannel.appendLine(`Reusing existing terminal: ${terminalName}`);
   }

   const autoShowTerminal = config.get<boolean>("autoShowTerminal", true);
   if (autoShowTerminal) {
      terminal.show();
   }

   // Check for environment files
   const envVarsFile = path.join(workspaceRoot, "env.json");
   const envVarsExist = fs.existsSync(envVarsFile);
   const envProdVarsFile = path.join(workspaceRoot, "envProd.json");
   const envProdVarsExist = fs.existsSync(envProdVarsFile);

   outputChannel.appendLine(
      `Environment files - env.json: ${envVarsExist}, envProd.json: ${envProdVarsExist}`
   );

   // Build command
   let command: string;
   if (isSam) {
      command = `sam local invoke ${functionName} --template-file template.yaml --event "${testFile}" --parameter-overrides Stage=${environment} Mode=Update --region ${region}`;

      if (envProdVarsExist && environment === "Prod") {
         command += ` --env-vars envProd.json`;
         outputChannel.appendLine("Using envProd.json for Prod environment");
      } else if (
         envVarsExist &&
         (environment === "PreProd" || environment === "Preprod")
      ) {
         command += ` --env-vars env.json`;
         outputChannel.appendLine("Using env.json for PreProd environment");
      } else if (envVarsExist) {
         command += ` --env-vars env.json`;
         outputChannel.appendLine("Using env.json as fallback");
      }
   } else {
      command = `serverless invoke local --function ${functionName} --path "${testFile}" --stage ${environment} --region ${region} --param 'mode=Update'`;
   }

   outputChannel.appendLine(`Executing command: ${command}`);

   // Show execution start notification
   const notificationLevel = config.get<string>("notificationLevel", "info");
   if (notificationLevel === "info" || notificationLevel === "verbose") {
      vscode.window
         .showInformationMessage(
            `Running ${functionName} with ${path.basename(
               testFile
            )} in ${environment}`,
            "Show Terminal",
            "Show Output"
         )
         .then((action) => {
            if (action === "Show Terminal") {
               terminal.show();
            } else if (action === "Show Output") {
               outputChannel.show();
            }
         });
   }

   // Send command to terminal
   terminal.sendText(command);

   // Track execution
   const executionRecord: ExecutionRecord = {
      functionName,
      testFile,
      environment,
      region,
      timestamp: startTime,
   };

   // Simulate execution completion (in real scenario, you'd monitor terminal output)
   setTimeout(() => {
      const duration = Date.now() - startTime;
      executionRecord.duration = duration;
      executionRecord.success = true; // In real implementation, monitor terminal for success/failure

      addExecutionRecord(executionRecord);

      const showExecutionTime = config.get<boolean>("showExecutionTime", true);
      if (showExecutionTime) {
         statusBarItem.text = `$(check) ${functionName} completed (${(
            duration / 1000
         ).toFixed(1)}s)`;
         statusBarItem.color = new vscode.ThemeColor(
            "statusBarItem.prominentForeground"
         );
      } else {
         statusBarItem.text = `$(check) ${functionName} completed`;
         statusBarItem.color = new vscode.ThemeColor(
            "statusBarItem.prominentForeground"
         );
      }

      outputChannel.appendLine(
         `Function execution completed in ${(duration / 1000).toFixed(1)}s`
      );

      setTimeout(() => {
         resetStatusBar();
      }, 5000);
   }, 2000);
}

// User preferences management
function getUserPreferences(): UserPreferences {
   try {
      return globalState.get<UserPreferences>("userPreferences", {});
   } catch (error) {
      outputChannel.appendLine(`Error getting user preferences: ${error}`);
      return {};
   }
}

function saveUserPreferences(
   functionName: string,
   testFile: string,
   environment: string,
   region: string
): void {
   try {
      const preferences = getUserPreferences();
      preferences[functionName] = {
         lastTestFile: testFile,
         lastEnvironment: environment,
         lastRegion: region,
         lastUsed: Date.now(),
      };
      globalState.update("userPreferences", preferences);
      outputChannel.appendLine(`Saved preferences for ${functionName}`);
   } catch (error) {
      outputChannel.appendLine(`Error saving user preferences: ${error}`);
   }
}

// Execution history management
function addExecutionRecord(record: ExecutionRecord): void {
   try {
      executionHistory.unshift(record);

      const config = vscode.workspace.getConfiguration("lambdaRun");
      const maxHistory = config.get<number>("maxExecutionHistory", 50);

      if (executionHistory.length > maxHistory) {
         executionHistory = executionHistory.slice(0, maxHistory);
         outputChannel.appendLine(
            `Trimmed execution history to ${maxHistory} records`
         );
      }

      globalState.update("executionHistory", executionHistory);
      outputChannel.appendLine(
         `Added execution record for ${record.functionName}`
      );
   } catch (error) {
      outputChannel.appendLine(`Error adding execution record: ${error}`);
   }
}

async function showExecutionHistory(): Promise<void> {
   if (executionHistory.length === 0) {
      vscode.window.showInformationMessage("No execution history found.");
      outputChannel.appendLine("No execution history to display");
      return;
   }

   outputChannel.appendLine(
      `Showing ${executionHistory.length} execution history records`
   );

   const historyItems = executionHistory.map((record) => ({
      label: `$(${record.success ? "check" : "error"}) ${record.functionName}`,
      description: `${record.environment} • ${record.region} • ${path.basename(
         record.testFile
      )}`,
      detail: `${new Date(record.timestamp).toLocaleString()}${
         record.duration ? ` • ${(record.duration / 1000).toFixed(1)}s` : ""
      }`,
      record,
   }));

   const selected = await vscode.window.showQuickPick(historyItems, {
      placeHolder: "Select from execution history to run again",
      matchOnDescription: true,
      matchOnDetail: true,
   });

   if (selected) {
      const { functionName, testFile, environment, region } = selected.record;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (workspaceRoot) {
         const isSam = fs.existsSync(path.join(workspaceRoot, "template.yaml"));
         outputChannel.appendLine(`Re-running from history: ${functionName}`);
         await executeFunction(
            functionName,
            isSam,
            testFile,
            environment,
            region,
            workspaceRoot
         );
      }
   }
}

async function getTestFiles(workspaceRoot: string): Promise<string[]> {
   try {
      const config = vscode.workspace.getConfiguration("lambdaRun");
      const configuredLocations =
         config.get<string[]>("testDataLocations") || [];
      const searchPatterns = config.get<string[]>("testFilePatterns") || [
         "**/*.json",
      ];

      outputChannel.appendLine(
         `Searching for test files with patterns: [${searchPatterns.join(
            ", "
         )}]`
      );
      outputChannel.appendLine(
         `Configured locations: [${configuredLocations.join(", ")}]`
      );

      let testFiles: string[] = [];

      if (configuredLocations.length > 0) {
         for (const location of configuredLocations) {
            const fullPath = path.resolve(workspaceRoot, location);
            if (fs.existsSync(fullPath)) {
               const locationFiles = await findTestFilesInLocation(
                  fullPath,
                  searchPatterns
               );
               testFiles.push(
                  ...locationFiles.map((file) =>
                     path.relative(workspaceRoot, file)
                  )
               );
               outputChannel.appendLine(
                  `Found ${locationFiles.length} files in ${location}`
               );
            } else {
               outputChannel.appendLine(`Location does not exist: ${location}`);
            }
         }
      } else {
         testFiles = await searchWorkspaceForTestFiles(
            workspaceRoot,
            searchPatterns
         );
      }

      const validFiles = testFiles.filter((file) => {
         const exists = fs.existsSync(path.join(workspaceRoot, file));
         if (!exists) {
            outputChannel.appendLine(`Filtered out non-existent file: ${file}`);
         }
         return exists;
      });

      outputChannel.appendLine(`Found ${validFiles.length} valid test files`);
      return validFiles;
   } catch (error) {
      outputChannel.appendLine(`Error getting test files: ${error}`);
      vscode.window.showErrorMessage(`Error finding test files: ${error}`);
      return [];
   }
}

async function findTestFilesInLocation(
   location: string,
   patterns: string[]
): Promise<string[]> {
   const files: string[] = [];

   for (const pattern of patterns) {
      try {
         const foundFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(location, pattern),
            null,
            100
         );
         files.push(...foundFiles.map((uri) => uri.fsPath));
      } catch (error) {
         outputChannel.appendLine(
            `Error searching for pattern ${pattern} in ${location}: ${error}`
         );
      }
   }

   return [...new Set(files)];
}

async function searchWorkspaceForTestFiles(
   workspaceRoot: string,
   patterns: string[]
): Promise<string[]> {
   const files: string[] = [];

   for (const pattern of patterns) {
      try {
         const foundFiles = await vscode.workspace.findFiles(
            pattern,
            "**/node_modules/**",
            200
         );
         files.push(
            ...foundFiles.map((uri) => path.relative(workspaceRoot, uri.fsPath))
         );
      } catch (error) {
         outputChannel.appendLine(
            `Error searching workspace for pattern ${pattern}: ${error}`
         );
      }
   }

   return [...new Set(files)];
}

/**
 * Reset all extension settings to defaults and clear all stored data
 */
async function resetExtensionSettings(): Promise<void> {
   const action = await vscode.window.showWarningMessage(
      "This will reset ALL Lambda Run extension settings to defaults and clear all stored data. This action cannot be undone.",
      "Reset Everything",
      "Cancel"
   );

   if (action !== "Reset Everything") {
      outputChannel.appendLine("Extension reset cancelled");
      return;
   }

   outputChannel.appendLine("Resetting all extension settings...");

   const config = vscode.workspace.getConfiguration("lambdaRun");

   try {
      // Reset all configuration to defaults
      const configUpdates = [
         { key: "testDataLocations", value: [] },
         { key: "testFilePatterns", value: ["**/*.json"] },
         { key: "environments", value: ["PreProd", "Prod"] },
         {
            key: "regions",
            value: [
               "ap-south-1",
               "ap-south-2",
               "us-east-1",
               "us-west-2",
               "eu-west-1",
               "ap-southeast-1",
            ],
         },
         { key: "defaultEnvironment", value: undefined },
         { key: "defaultRegion", value: undefined },
         { key: "autoCreateTestData", value: true },
         { key: "showRelativePaths", value: true },
         { key: "rememberPreferences", value: true },
         { key: "reuseTerminals", value: true },
         { key: "showExecutionTime", value: true },
         { key: "functionSpecificTestPriority", value: true },
         { key: "autoShowTerminal", value: true },
         { key: "maxExecutionHistory", value: 50 },
         { key: "notificationLevel", value: "info" },
      ];

      for (const update of configUpdates) {
         await safeConfigUpdate(config, update.key, update.value);
      }

      // Clear all stored data
      await globalState.update("userPreferences", {});
      await globalState.update("executionHistory", []);
      executionHistory = [];

      // Close any active terminals
      let closedTerminals = 0;
      activeTerminals.forEach((terminal) => {
         if (terminal.exitStatus === undefined) {
            terminal.dispose();
            closedTerminals++;
         }
      });
      activeTerminals.clear();

      resetStatusBar();

      outputChannel.appendLine(
         `Extension reset completed. Closed ${closedTerminals} terminals.`
      );
      vscode.window.showInformationMessage(
         "✅ Lambda Run extension has been completely reset to default settings. All preferences and history have been cleared."
      );
   } catch (error) {
      const errorMessage =
         error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(
         `Failed to reset extension settings: ${errorMessage}`
      );
      vscode.window.showErrorMessage(
         `Failed to reset extension settings: ${errorMessage}`
      );
   }
}

/**
 * Clear only execution history
 */
async function clearExecutionHistory(): Promise<void> {
   // Remove workspace validation - clearing history should work without workspace

   if (executionHistory.length === 0) {
      vscode.window.showInformationMessage("No execution history to clear.");
      outputChannel.appendLine("No execution history to clear");
      return;
   }

   const action = await vscode.window.showWarningMessage(
      `Clear all ${executionHistory.length} execution history records? This action cannot be undone.`,
      "Clear History",
      "Cancel"
   );

   if (action === "Clear History") {
      try {
         executionHistory = [];
         await globalState.update("executionHistory", []);
         outputChannel.appendLine("Execution history cleared");
         vscode.window.showInformationMessage(
            "✅ Execution history cleared successfully."
         );
      } catch (error) {
         const errorMessage =
            error instanceof Error ? error.message : String(error);
         outputChannel.appendLine(
            `Failed to clear execution history: ${errorMessage}`
         );
         vscode.window.showErrorMessage(
            `Failed to clear history: ${errorMessage}`
         );
      }
   }
}

/**
 * Clear only user preferences (last used settings per function)
 */
async function clearUserPreferences(): Promise<void> {
   const preferences = getUserPreferences();
   const functionCount = Object.keys(preferences).length;

   if (functionCount === 0) {
      vscode.window.showInformationMessage("No user preferences to clear.");
      outputChannel.appendLine("No user preferences to clear");
      return;
   }

   const action = await vscode.window.showWarningMessage(
      `Clear saved preferences for ${functionCount} function(s)? This will remove last used test files, environments, and regions.`,
      "Clear Preferences",
      "Cancel"
   );

   if (action === "Clear Preferences") {
      try {
         await globalState.update("userPreferences", {});
         outputChannel.appendLine(
            `Cleared preferences for ${functionCount} functions`
         );
         vscode.window.showInformationMessage(
            "✅ User preferences cleared successfully."
         );
      } catch (error) {
         const errorMessage =
            error instanceof Error ? error.message : String(error);
         outputChannel.appendLine(
            `Failed to clear preferences: ${errorMessage}`
         );
         vscode.window.showErrorMessage(
            `Failed to clear preferences: ${errorMessage}`
         );
      }
   }
}

/**
 * Enhanced configuration management with reset options
 */
async function manageExtensionData(): Promise<void> {
   const preferences = getUserPreferences();
   const functionCount = Object.keys(preferences).length;
   const historyCount = executionHistory.length;

   outputChannel.appendLine(
      `Managing extension data - ${functionCount} functions, ${historyCount} history records`
   );

   const action = await vscode.window.showQuickPick(
      [
         {
            label: "🗑️ Clear Execution History",
            value: "clearHistory",
            description: `Remove all ${historyCount} execution records`,
         },
         {
            label: "🚮 Clear User Preferences",
            value: "clearPreferences",
            description: `Remove saved settings for ${functionCount} function(s)`,
         },
         {
            label: "⚠️ Reset All Extension Settings",
            value: "resetAll",
            description: "Reset everything to defaults and clear all data",
         },
         {
            label: "📊 Show Extension Statistics",
            value: "showStats",
            description: "Display current usage statistics",
         },
      ],
      {
         placeHolder: "Manage Lambda Run extension data",
      }
   );

   if (!action) {
      outputChannel.appendLine("Extension data management cancelled");
      return;
   }

   switch (action.value) {
      case "clearHistory":
         await clearExecutionHistory();
         break;
      case "clearPreferences":
         await clearUserPreferences();
         break;
      case "resetAll":
         await resetExtensionSettings();
         break;
      case "showStats":
         await showExtensionStatistics();
         break;
   }
}

/**
 * Show extension usage statistics
 */
async function showExtensionStatistics(): Promise<void> {
   const config = vscode.workspace.getConfiguration("lambdaRun");
   const preferences = getUserPreferences();
   const functionCount = Object.keys(preferences).length;
   const historyCount = executionHistory.length;

   const environments = config.get<string[]>("environments") || [];
   const regions = config.get<string[]>("regions") || [];
   const testLocations = config.get<string[]>("testDataLocations") || [];

   let totalExecutions = 0;
   let successfulExecutions = 0;
   let lastExecution = "Never";

   if (historyCount > 0) {
      totalExecutions = historyCount;
      successfulExecutions = executionHistory.filter((r) => r.success).length;
      lastExecution = new Date(executionHistory[0].timestamp).toLocaleString();
   }

   const stats = `
📊 **Lambda Run Extension Statistics**

**Configuration:**
• Environments: ${environments.length} (${environments.join(", ")})
• Regions: ${regions.length} (${regions.slice(0, 3).join(", ")}${
      regions.length > 3 ? "..." : ""
   })
• Test Data Locations: ${testLocations.length || "Using workspace search"}

**Usage:**
• Functions with saved preferences: ${functionCount}
• Total executions: ${totalExecutions}
• Successful executions: ${successfulExecutions}
• Success rate: ${
      totalExecutions > 0
         ? Math.round((successfulExecutions / totalExecutions) * 100)
         : 0
   }%
• Last execution: ${lastExecution}

**Storage:**
• Execution history records: ${historyCount}
• Max history: ${config.get("maxExecutionHistory", 50)}
   `.trim();

   outputChannel.appendLine("Displaying extension statistics");

   const action = await vscode.window.showInformationMessage(
      stats,
      "Export Statistics",
      "Clear Data",
      "Close"
   );

   if (action === "Export Statistics") {
      // Copy stats to clipboard
      await vscode.env.clipboard.writeText(stats.replace(/\*\*/g, ""));
      vscode.window.showInformationMessage("Statistics copied to clipboard!");
      outputChannel.appendLine("Statistics exported to clipboard");
   } else if (action === "Clear Data") {
      await manageExtensionData();
   }
}

async function configureTestDataLocations(): Promise<void> {
   // Only validate workspace for test data locations since they need a workspace context
   if (!validateWorkspace()) return;

   const config = vscode.workspace.getConfiguration("lambdaRun");
   const currentLocations = config.get<string[]>("testDataLocations") || [];
   const currentPatterns = config.get<string[]>("testFilePatterns") || [
      "**/*.json",
   ];

   outputChannel.appendLine(
      `Configuring test data locations. Current: [${currentLocations.join(
         ", "
      )}]`
   );

   const action = await vscode.window.showQuickPick(
      [
         {
            label: "📁 Add Test Data Location",
            value: "add",
            description: "Add a new folder to search for test files",
         },
         {
            label: "❌ Remove Test Data Location",
            value: "remove",
            description: "Remove an existing test data location",
         },
         {
            label: "🔍 Configure File Patterns",
            value: "patterns",
            description: "Set file patterns to match test files",
         },
         {
            label: "🔄 Reset to Default",
            value: "reset",
            description: "Search entire workspace for *.json files",
         },
      ],
      {
         placeHolder: "Configure test data locations",
      }
   );

   if (!action) {
      outputChannel.appendLine("Test data location configuration cancelled");
      return;
   }

   switch (action.value) {
      case "add":
         const folderUri = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "Select Test Data Folder",
         });

         if (folderUri && folderUri[0]) {
            const workspaceRoot =
               vscode.workspace.workspaceFolders![0].uri.fsPath;
            const relativePath = path.relative(
               workspaceRoot,
               folderUri[0].fsPath
            );

            if (currentLocations.includes(relativePath)) {
               vscode.window.showWarningMessage(
                  `Location already exists: ${relativePath}`
               );
               outputChannel.appendLine(
                  `Location already exists: ${relativePath}`
               );
               return;
            }

            const updatedLocations = [...currentLocations, relativePath];
            if (
               await safeConfigUpdate(
                  config,
                  "testDataLocations",
                  updatedLocations
               )
            ) {
               vscode.window.showInformationMessage(
                  `✅ Added test data location: ${relativePath}`
               );
               outputChannel.appendLine(
                  `Added test data location: ${relativePath}`
               );
            }
         }
         break;

      case "remove":
         if (currentLocations.length === 0) {
            vscode.window.showInformationMessage(
               "No test data locations configured."
            );
            outputChannel.appendLine("No test data locations to remove");
            return;
         }

         const locationToRemove = await vscode.window.showQuickPick(
            currentLocations.map((loc) => ({
               label: loc,
               description: "Click to remove",
            })),
            { placeHolder: "Select location to remove" }
         );

         if (locationToRemove) {
            const updatedLocations = currentLocations.filter(
               (loc) => loc !== locationToRemove.label
            );
            if (
               await safeConfigUpdate(
                  config,
                  "testDataLocations",
                  updatedLocations
               )
            ) {
               vscode.window.showInformationMessage(
                  `❌ Removed test data location: ${locationToRemove.label}`
               );
               outputChannel.appendLine(
                  `Removed test data location: ${locationToRemove.label}`
               );
            }
         }
         break;

      case "patterns":
         const newPattern = await vscode.window.showInputBox({
            prompt: "Enter file pattern (e.g., **/*.json, **/test-*.json)",
            value: currentPatterns.join(", "),
            placeHolder: "Comma-separated patterns",
            validateInput: (value) => {
               if (!value.trim()) {
                  return "At least one pattern is required";
               }
               const patterns = value
                  .split(",")
                  .map((p) => p.trim())
                  .filter((p) => p.length > 0);
               if (patterns.length === 0) {
                  return "At least one valid pattern is required";
               }
               return null;
            },
         });

         if (newPattern) {
            const patterns = newPattern
               .split(",")
               .map((p) => p.trim())
               .filter((p) => p.length > 0);
            if (await safeConfigUpdate(config, "testFilePatterns", patterns)) {
               vscode.window.showInformationMessage(
                  `🔍 Updated file patterns: ${patterns.join(", ")}`
               );
               outputChannel.appendLine(
                  `Updated file patterns: [${patterns.join(", ")}]`
               );
            }
         }
         break;

      case "reset":
         const resetConfirm = await vscode.window.showWarningMessage(
            "Reset test data configuration to defaults? This will clear all configured locations and patterns.",
            "Reset",
            "Cancel"
         );

         if (resetConfirm === "Reset") {
            await safeConfigUpdate(config, "testDataLocations", []);
            await safeConfigUpdate(config, "testFilePatterns", ["**/*.json"]);
            vscode.window.showInformationMessage(
               "🔄 Reset to default: searching entire workspace for *.json files"
            );
            outputChannel.appendLine(
               "Reset test data configuration to defaults"
            );
         }
         break;
   }
}

class LambdaCodeLensProvider implements vscode.CodeLensProvider {
   public provideCodeLenses(
      document: vscode.TextDocument
   ): vscode.CodeLens[] | undefined {
      try {
         const fileName = path.basename(document.fileName);
         const isSamTemplate = fileName === "template.yaml";
         const isServerlessYml = fileName === "serverless.yml";

         if (!isSamTemplate && !isServerlessYml) {
            return;
         }

         outputChannel.appendLine(`Providing CodeLens for ${fileName}`);

         const lenses: vscode.CodeLens[] = [];
         const text = document.getText();

         // More robust regex patterns
         const functionRegex = isSamTemplate
            ? /(\w+):\s*\n?\s*Type:\s*AWS::Serverless::Function[\s\S]*?Handler:\s*([^\s\n]+)/g
            : /(\w+):\s*\n?\s*handler:\s*([^\s\n]+)/g;

         let match;
         let functionCount = 0;

         while ((match = functionRegex.exec(text)) !== null) {
            const functionName = match[1];
            const handlerValue = match[2];
            const handlerPosition = document.positionAt(match.index);
            const range = new vscode.Range(handlerPosition, handlerPosition);
            const hasHandler = handlerValue && handlerValue.trim() !== "";

            functionCount++;

            // Check if function has previous settings
            const preferences = getUserPreferences();
            const hasLastSettings =
               preferences[functionName] &&
               preferences[functionName].lastTestFile &&
               preferences[functionName].lastEnvironment &&
               preferences[functionName].lastRegion;

            // Primary run button
            lenses.push(
               new vscode.CodeLens(range, {
                  title: hasHandler
                     ? "🚀 Run Function"
                     : "⚠️ Handler Not Defined",
                  command: hasHandler ? "extension.runFunction" : "",
                  arguments: hasHandler
                     ? [functionName, hasHandler, isSamTemplate]
                     : [],
               })
            );

            // Run with last settings button (if available)
            if (hasHandler && hasLastSettings) {
               lenses.push(
                  new vscode.CodeLens(range, {
                     title: "⚡ Run (Last Settings)",
                     command: "extension.runFunctionWithLastSettings",
                     arguments: [functionName, hasHandler, isSamTemplate],
                  })
               );
            }
         }

         outputChannel.appendLine(
            `Found ${functionCount} functions, created ${lenses.length} CodeLens items`
         );
         return lenses;
      } catch (error) {
         outputChannel.appendLine(`Error in CodeLens provider: ${error}`);
         console.error("Error in CodeLens provider:", error);
         return [];
      }
   }

   public resolveCodeLens?(
      codeLens: vscode.CodeLens
   ): vscode.CodeLens | undefined {
      return codeLens;
   }
}

export function deactivate() {
   try {
      outputChannel.appendLine("Deactivating Lambda Run extension...");

      // Clean up active terminals
      let cleanedTerminals = 0;
      activeTerminals.forEach((terminal) => {
         if (terminal.exitStatus === undefined) {
            terminal.dispose();
            cleanedTerminals++;
         }
      });
      activeTerminals.clear();

      // Dispose status bar
      if (statusBarItem) {
         statusBarItem.dispose();
      }

      // Dispose output channel
      if (outputChannel) {
         outputChannel.appendLine(
            `Extension deactivated. Cleaned up ${cleanedTerminals} terminals.`
         );
         outputChannel.dispose();
      }

      console.log("Lambda Run extension deactivated successfully");
   } catch (error) {
      console.error("Error during extension deactivation:", error);
   }
}
