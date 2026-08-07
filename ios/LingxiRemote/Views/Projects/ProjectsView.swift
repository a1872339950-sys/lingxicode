import SwiftUI

struct ProjectsView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        NavigationStack {
            List(appState.projects) { project in
                Button {
                    switchProject(project)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(project.displayName)
                            .font(.headline)
                        HStack {
                            Text(project.path)
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Spacer()
                            if let branch = project.currentBranch {
                                Label(branch, systemImage: "arrow.triangle.branch")
                                    .font(.caption2)
                                    .foregroundColor(.blue)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)
            }
            .navigationTitle("项目")
            .onAppear {
                loadProjects()
            }
            .refreshable {
                loadProjects()
            }
        }
    }

    private func loadProjects() {
        Task {
            if let result = try? await appState.bridgeClient.sendCommand(action: "project:list") {
                let rawProjects = result["projects"] as? [[String: Any]] ?? []
                appState.projects = rawProjects.compactMap(Project.fromDictionary)
            }
        }
    }

    private func switchProject(_ project: Project) {
        appState.currentProjectId = project.id
        appState.messages = []
        Task {
            try? await appState.bridgeClient.sendCommand(
                action: "project:switch",
                payload: ["projectId": project.id]
            )
            if let history = try? await appState.bridgeClient.sendCommand(
                action: "chat:history",
                payload: ["projectId": project.id]
            ) {
                let rawMessages = history["messagesHistory"] as? [[String: Any]]
                    ?? history["messages"] as? [[String: Any]]
                    ?? []
                appState.messages = rawMessages.compactMap(ChatMessage.fromDictionary)
            }
        }
    }
}
