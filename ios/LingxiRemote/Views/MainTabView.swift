import SwiftUI

struct MainTabView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        TabView {
            ChatView()
                .tabItem {
                    Image(systemName: "bubble.left.and.bubble.right")
                    Text("聊天")
                }

            ProjectsView()
                .tabItem {
                    Image(systemName: "folder")
                    Text("项目")
                }

            TerminalView()
                .tabItem {
                    Image(systemName: "terminal")
                    Text("终端")
                }

            SettingsView()
                .tabItem {
                    Image(systemName: "gear")
                    Text("设置")
                }
        }
        .onAppear {
            appState.connect()
        }
    }
}
