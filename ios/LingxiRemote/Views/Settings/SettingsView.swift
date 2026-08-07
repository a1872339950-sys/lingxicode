import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        NavigationStack {
            List {
                Section("连接") {
                    HStack {
                        Text("状态")
                        Spacer()
                        Text(connectionStatusText)
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("服务器")
                        Spacer()
                        Text("\(appState.serverAddress):\(appState.serverPort)")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("设备名")
                        Spacer()
                        Text(appState.deviceName)
                            .foregroundColor(.secondary)
                    }
                    Button("断开连接") {
                        appState.disconnect()
                    }
                    .foregroundColor(.red)
                }

                Section("关于") {
                    HStack {
                        Text("版本")
                        Spacer()
                        Text("1.0.0")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .navigationTitle("设置")
        }
    }

    private var connectionStatusText: String {
        switch appState.connectionState {
        case .connected: return "已连接"
        case .connecting: return "连接中"
        case .reconnecting: return "重连中"
        case .disconnected: return "未连接"
        }
    }
}
