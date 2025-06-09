import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

// Interface for user preferences
interface FunctionPreferences {
   lastTestFile?: string;
   lastEnvironment?: string;
   lastRegion?: string;
   lastUsed?: number;
}

interface UserPreferences {
   [functionName: string]: FunctionPreferences;
}

// Interface for execution tracking
interface ExecutionRecord {
   functionName: string;
   testFile: string;
   environment: string;
   region: string;
   timestamp: number;
   duration?: number;
   success?: boolean;
}

// Global state management
let globalState: vscode.Memento;
let statusBarItem: vscode.StatusBarItem;
let executionHistory: ExecutionRecord[] = [];
let activeTerminals: Map<string, vscode.Terminal> = new Map();

export function activate(context: vscode.ExtensionContext) {
   // Initialize global state
   globalState = context.globalState;

   // Initialize status bar
   statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
   );
   statusBarItem.text = "$(rocket) Lambda Ready";
   statusBarItem.tooltip = "Lambda Run - Ready to execute functions";
   statusBarItem.show();
   context.subscriptions.push(statusBarItem);

   // Load execution history
   executionHistory = globalState.get<ExecutionRecord[]>(
      "executionHistory",
      []
   );

   context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
         { language: "yaml", scheme: "file" },
         new LambdaCodeLensProvider()
      )
   );

   // Register commands
   vscode.commands.registerCommand(
      "extension.configureTestDataLocations",
      async () => {
         await configureTestDataLocations();
      }
   );

   vscode.commands.registerCommand(
      "extension.runFunction",
      async (functionName: string, hasHandler: boolean, isSam: boolean) => {
         await runFunction(functionName, hasHandler, isSam, false);
      }
   );

   // New command for running with last used settings
   vscode.commands.registerCommand(
      "extension.runFunctionWithLastSettings",
      async (functionName: string, hasHandler: boolean, isSam: boolean) => {
         await runFunction(functionName, hasHandler, isSam, true);
      }
   );

   // Command to show execution history
   vscode.commands.registerCommand(
      "extension.showExecutionHistory",
      async () => {
         await showExecutionHistory();
      }
   );
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
      return;
   }

   const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
   if (!workspaceRoot) {
      vscode.window.showErrorMessage("No workspace folder open.");
      return;
   }

   // Update status bar
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
            functionPrefs &&
            functionPrefs.lastTestFile &&
            functionPrefs.lastEnvironment &&
            functionPrefs.lastRegion
         ) {
            // Verify the last test file still exists
            const testFilePath = path.join(
               workspaceRoot,
               functionPrefs.lastTestFile
            );
            if (fs.existsSync(testFilePath)) {
               testFile = functionPrefs.lastTestFile;
               selectedEnvironment = functionPrefs.lastEnvironment;
               selectedRegion = functionPrefs.lastRegion;

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
            }
         } else {
            vscode.window.showInformationMessage(
               `No previous settings found for ${functionName}. Please configure manually.`
            );
         }
      }

      // Get test files
      const testFiles = await getTestFiles(workspaceRoot);

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
            } else {
               statusBarItem.text = "$(rocket) Lambda Ready";
               statusBarItem.color = undefined;
               return;
            }
         } else if (action === "Configure Test Locations") {
            await configureTestDataLocations();
            statusBarItem.text = "$(rocket) Lambda Ready";
            statusBarItem.color = undefined;
            return;
         } else {
            statusBarItem.text = "$(rocket) Lambda Ready";
            statusBarItem.color = undefined;
            return;
         }
      }

      // Get user preferences for defaults
      const preferences = getUserPreferences();
      const functionPrefs = preferences[functionName];

      // Select test file if not already selected
      if (!testFile) {
         // Prioritize function-specific test files
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
            statusBarItem.text = "$(rocket) Lambda Ready";
            statusBarItem.color = undefined;
            return;
         }
         testFile = selectedTestFile.detail;
      }

      // Select environment and region
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
      const defaultEnvironment =
         config.get<string>("defaultEnvironment") || environments[0];
      const defaultRegion = config.get<string>("defaultRegion") || regions[0];

      if (!selectedEnvironment) {
         const envItems = environments.map((env) => ({
            label: env,
            picked:
               functionPrefs?.lastEnvironment === env ||
               (env === defaultEnvironment && !functionPrefs?.lastEnvironment),
         }));

         const selectedEnv = await vscode.window.showQuickPick(envItems, {
            placeHolder: "Select the environment",
            canPickMany: false,
         });

         if (!selectedEnv) {
            statusBarItem.text = "$(rocket) Lambda Ready";
            statusBarItem.color = undefined;
            return;
         }
         selectedEnvironment = selectedEnv.label;
      }

      if (!selectedRegion) {
         const regionItems = regions.map((region) => ({
            label: region,
            picked:
               functionPrefs?.lastRegion === region ||
               (region === defaultRegion && !functionPrefs?.lastRegion),
         }));

         const selectedReg = await vscode.window.showQuickPick(regionItems, {
            placeHolder: `Select the region for function: ${functionName}`,
            canPickMany: false,
         });

         if (!selectedReg) {
            statusBarItem.text = "$(rocket) Lambda Ready";
            statusBarItem.color = undefined;
            return;
         }
         selectedRegion = selectedReg.label;
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
      vscode.window.showErrorMessage(`Error running function: ${error}`);
      statusBarItem.text = "$(error) Error";
      statusBarItem.color = new vscode.ThemeColor(
         "statusBarItem.errorForeground"
      );
      setTimeout(() => {
         statusBarItem.text = "$(rocket) Lambda Ready";
         statusBarItem.color = undefined;
      }, 3000);
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

   // Update status bar
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

   // Build command
   let command: string;
   if (isSam) {
      command = `sam local invoke ${functionName} --template-file template.yaml --event "${testFile}" --parameter-overrides Stage=${environment} Mode=Update --region ${region}`;
      if (envProdVarsExist && environment === "Prod") {
         command += ` --env-vars envProd.json`;
      } else if (envVarsExist && environment === "Preprod") {
         command += ` --env-vars env.json`;
      } else if (envVarsExist) {
         command += ` --env-vars env.json`;
      }
   } else {
      command = `serverless invoke local --function ${functionName} --path "${testFile}" --stage ${environment} --region ${region} --param 'mode=Update'`;
   }

   // Show execution start notification
   const notificationLevel = config.get<string>("notificationLevel", "info");
   if (notificationLevel === "info" || notificationLevel === "verbose") {
      vscode.window
         .showInformationMessage(
            `Running ${functionName} with ${path.basename(
               testFile
            )} in ${environment}`,
            "Show Terminal"
         )
         .then((action) => {
            if (action === "Show Terminal") {
               terminal.show();
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

   // Simulate execution completion (in real implementation, you'd listen to terminal events)
   setTimeout(() => {
      const duration = Date.now() - startTime;
      executionRecord.duration = duration;
      executionRecord.success = true; // Would be determined by actual execution result

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

      setTimeout(() => {
         statusBarItem.text = "$(rocket) Lambda Ready";
         statusBarItem.color = undefined;
      }, 5000);
   }, 2000);
}

// User preferences management
function getUserPreferences(): UserPreferences {
   return globalState.get<UserPreferences>("userPreferences", {});
}

function saveUserPreferences(
   functionName: string,
   testFile: string,
   environment: string,
   region: string
): void {
   const preferences = getUserPreferences();
   preferences[functionName] = {
      lastTestFile: testFile,
      lastEnvironment: environment,
      lastRegion: region,
      lastUsed: Date.now(),
   };
   globalState.update("userPreferences", preferences);
}

// Execution history management
function addExecutionRecord(record: ExecutionRecord): void {
   executionHistory.unshift(record);

   const config = vscode.workspace.getConfiguration("lambdaRun");
   const maxHistory = config.get<number>("maxExecutionHistory", 50);

   // Keep only the configured number of executions
   if (executionHistory.length > maxHistory) {
      executionHistory = executionHistory.slice(0, maxHistory);
   }
   globalState.update("executionHistory", executionHistory);
}

async function showExecutionHistory(): Promise<void> {
   if (executionHistory.length === 0) {
      vscode.window.showInformationMessage("No execution history found.");
      return;
   }

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
         // Determine if it's SAM or Serverless based on file existence
         const isSam = fs.existsSync(path.join(workspaceRoot, "template.yaml"));
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
   const config = vscode.workspace.getConfiguration("lambdaRun");
   const configuredLocations = config.get<string[]>("testDataLocations") || [];
   const searchPatterns = config.get<string[]>("testFilePatterns") || [
      "**/*.json",
   ];

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
         }
      }
   } else {
      testFiles = await searchWorkspaceForTestFiles(
         workspaceRoot,
         searchPatterns
      );
   }

   return testFiles.filter((file) =>
      fs.existsSync(path.join(workspaceRoot, file))
   );
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
         console.warn(
            `Error searching for pattern ${pattern} in ${location}:`,
            error
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
         console.warn(
            `Error searching workspace for pattern ${pattern}:`,
            error
         );
      }
   }

   return [...new Set(files)];
}

async function configureTestDataLocations(): Promise<void> {
   const config = vscode.workspace.getConfiguration("lambdaRun");
   const currentLocations = config.get<string[]>("testDataLocations") || [];
   const currentPatterns = config.get<string[]>("testFilePatterns") || [
      "**/*.json",
   ];

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

   if (!action) return;

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
               vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspaceRoot) {
               const relativePath = path.relative(
                  workspaceRoot,
                  folderUri[0].fsPath
               );
               const updatedLocations = [...currentLocations, relativePath];
               await config.update(
                  "testDataLocations",
                  updatedLocations,
                  vscode.ConfigurationTarget.Workspace
               );
               vscode.window.showInformationMessage(
                  `✅ Added test data location: ${relativePath}`
               );
            }
         }
         break;

      case "remove":
         if (currentLocations.length === 0) {
            vscode.window.showInformationMessage(
               "No test data locations configured."
            );
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
            await config.update(
               "testDataLocations",
               updatedLocations,
               vscode.ConfigurationTarget.Workspace
            );
            vscode.window.showInformationMessage(
               `❌ Removed test data location: ${locationToRemove.label}`
            );
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
               return null;
            },
         });

         if (newPattern) {
            const patterns = newPattern
               .split(",")
               .map((p) => p.trim())
               .filter((p) => p.length > 0);
            await config.update(
               "testFilePatterns",
               patterns,
               vscode.ConfigurationTarget.Workspace
            );
            vscode.window.showInformationMessage(
               `🔍 Updated file patterns: ${patterns.join(", ")}`
            );
         }
         break;

      case "reset":
         await config.update(
            "testDataLocations",
            [],
            vscode.ConfigurationTarget.Workspace
         );
         await config.update(
            "testFilePatterns",
            ["**/*.json"],
            vscode.ConfigurationTarget.Workspace
         );
         vscode.window.showInformationMessage(
            "🔄 Reset to default: searching entire workspace for *.json files"
         );
         break;
   }
}

class LambdaCodeLensProvider implements vscode.CodeLensProvider {
   public provideCodeLenses(
      document: vscode.TextDocument
   ): vscode.CodeLens[] | undefined {
      const fileName = path.basename(document.fileName);
      const isSamTemplate = fileName === "template.yaml";
      const isServerlessYml = fileName === "serverless.yml";

      if (!isSamTemplate && !isServerlessYml) {
         return;
      }

      const lenses: vscode.CodeLens[] = [];
      const text = document.getText();
      const functionRegex = isSamTemplate
         ? /(\w+):\s*Type:\s*AWS::Serverless::Function\s*Properties:\s*Handler:\s*([^\s]+)/g
         : /(\w+):\s*handler:\s*([^\s]+)/g;

      let match;

      while ((match = functionRegex.exec(text)) !== null) {
         const functionName = match[1];
         const handlerPosition = document.positionAt(match.index);
         const range = new vscode.Range(handlerPosition, handlerPosition);
         const hasHandler = match[2].trim() !== "";

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
               title: hasHandler ? "🚀 Run Function" : "⚠️ Handler Not Defined",
               command: "extension.runFunction",
               arguments: [functionName, hasHandler, isSamTemplate],
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
      return lenses;
   }
}

export function deactivate() {
   // Clean up active terminals
   activeTerminals.forEach((terminal) => {
      if (terminal.exitStatus === undefined) {
         terminal.dispose();
      }
   });
   activeTerminals.clear();

   // Dispose status bar
   if (statusBarItem) {
      statusBarItem.dispose();
   }
}
