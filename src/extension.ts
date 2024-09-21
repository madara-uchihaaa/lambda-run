import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "yaml", scheme: "file" },
			new ServerlessCodeLensProvider()
		)
	);

	vscode.commands.registerCommand(
		"extension.runFunction",
		async (functionName: string, hasHandler: boolean, isSam: boolean) => {
			if (!hasHandler) {
				vscode.window.showErrorMessage(
					`Handler not defined for the function: ${functionName}`
				);
				return;
			}
			const workspaceRoot =
				vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
			if (!workspaceRoot) {
				vscode.window.showErrorMessage("No workspace folder open.");
				return;
			}

			const testDataDir = path.join(workspaceRoot, "test-data");

			if (!fs.existsSync(testDataDir)) {
				fs.mkdirSync(testDataDir);
				vscode.window.showInformationMessage(
					"No test-data folder found, created one. Please add test files."
				);
				return;
			}
			const testFiles = fs
				.readdirSync(testDataDir)
				.filter((file) => file.endsWith(".json"));

			if (testFiles.length === 0) {
				vscode.window.showErrorMessage(
					"No test files found in the test-data folder."
				);
				return;
			}

			const selectedTestFile = await vscode.window.showQuickPick(testFiles, {
				placeHolder: `Select a test file for function: ${functionName}`,
			});

			if (!selectedTestFile) {
				vscode.window.showErrorMessage("No test file selected.");
				return;
			}

			const environments = ["Preprod", "Prod"];
			const selectedEnvironment = await vscode.window.showQuickPick(
				environments,
				{
					placeHolder: "Select the environment",
					canPickMany: false,
				}
			);

			if (!selectedEnvironment) {
				vscode.window.showErrorMessage("No environment selected.");
				return;
			}

			const region = await vscode.window.showInputBox({
				prompt: `Enter the region for the function: ${functionName}`,
				value: "ap-south-1",
			});

			if (!region) {
				vscode.window.showErrorMessage("No region specified.");
				return;
			}

			const envVarsFile = path.join(workspaceRoot, "env.json");
			const envVarsExist = fs.existsSync(envVarsFile);

			const envProdVarsFile = path.join(workspaceRoot, "envProd.json");
			const envProdVarsExist = fs.existsSync(envProdVarsFile);

			const terminal = vscode.window.createTerminal({
				name: "Serverless Test",
				cwd: workspaceRoot,
			});
			terminal.show();

			let command: string;
			if (isSam) {
				command = `sam local invoke ${functionName} --template-file template.yaml --event test-data/${selectedTestFile} --parameter-overrides Stage=${selectedEnvironment} Mode=Update --region ${region}`;
				if (envProdVarsExist && selectedEnvironment === "Prod") {
					command += ` --env-vars envProd.json`;
				} else if (envVarsExist && selectedEnvironment === "Preprod") {
					command += ` --env-vars env.json`;
				} else {
					command += ` --env-vars env.json`;
				}
			} else {
				command = `serverless invoke local --function ${functionName} --path test-data/${selectedTestFile} --stage ${selectedEnvironment} --region ${region} --param 'mode=Update'`;
			}

			terminal.sendText(command);
		}
	);
}

class ServerlessCodeLensProvider implements vscode.CodeLensProvider {
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
			lenses.push(
				new vscode.CodeLens(range, {
					title: hasHandler ? "Run This Function" : "Handler Not Defined",
					command: "extension.runFunction",
					arguments: [functionName, hasHandler, isSamTemplate],
				})
			);
		}
		return lenses;
	}
}  