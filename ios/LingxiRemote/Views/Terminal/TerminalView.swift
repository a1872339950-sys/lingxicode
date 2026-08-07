import SwiftUI

struct TerminalView: View {
    @State private var commandInput: String = ""
    @State private var output: [String] = []
    @EnvironmentObject var appState: AppState

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(output, id: \.self) { line in
                            Text(line)
                                .font(.system(.caption, design: .monospaced))
                                .foregroundColor(.green)
                        }
                    }
                    .padding()
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .background(Color.black)

                HStack {
                    Text("$")
                        .foregroundColor(.green)
                    TextField("输入命令", text: $commandInput)
                        .textFieldStyle(.plain)
                        .font(.system(.body, design: .monospaced))
                        .onSubmit(executeCommand)
                    Button("执行", action: executeCommand)
                        .disabled(commandInput.isEmpty)
                }
                .padding()
                .background(Color(.systemGray6))
            }
            .navigationTitle("终端")
        }
    }

    private func executeCommand() {
        guard !commandInput.isEmpty else { return }
        output.append("$ \(commandInput)")
        let cmd = commandInput
        commandInput = ""
        Task {
            if let result = try? await appState.bridgeClient.sendCommand(
                action: "terminal:run",
                payload: ["command": cmd, "projectId": appState.currentProjectId ?? ""]
            ) {
                if let out = result["output"] as? String {
                    output.append(out)
                }
            }
        }
    }
}
