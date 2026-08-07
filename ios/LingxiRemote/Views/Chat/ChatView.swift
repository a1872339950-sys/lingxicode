import SwiftUI

struct ChatView: View {
    @EnvironmentObject var appState: AppState
    @State private var inputText: String = ""
    @State private var showingProjectPicker: Bool = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // 连接状态条
                ConnectionStatusBar()

                // 消息列表
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            ForEach(appState.messages) { message in
                                MessageBubbleView(message: message)
                                    .id(message.id)
                            }
                        }
                        .padding()
                    }
                    .onChange(of: appState.messages.count) { _, _ in
                        if let lastId = appState.messages.last?.id {
                            withAnimation { proxy.scrollTo(lastId, anchor: .bottom) }
                        }
                    }
                }

                // 输入栏
                HStack(spacing: 12) {
                    TextField("输入消息...", text: $inputText, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(1...5)

                    if appState.aiStatus == .streaming || appState.aiStatus == .thinking {
                        Button {
                            Task {
                                try? await appState.bridgeClient.sendCommand(
                                    action: "chat:interrupt",
                                    payload: ["projectId": appState.currentProjectId ?? ""]
                                )
                            }
                        } label: {
                            Image(systemName: "stop.circle.fill")
                                .font(.title)
                                .foregroundColor(.red)
                        }
                    } else {
                        Button {
                            sendMessage()
                        } label: {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title)
                                .foregroundColor(inputText.isEmpty ? .gray : .blue)
                        }
                        .disabled(inputText.isEmpty)
                    }
                }
                .padding()
                .background(Color(.systemBackground))
            }
            .navigationTitle(appState.currentProjectId ?? "灵犀遥控")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    private func sendMessage() {
        guard !inputText.isEmpty else { return }
        let text = inputText
        inputText = ""

        // 添加用户消息到列表
        appState.messages.append(ChatMessage(role: .user, content: text))

        Task {
            try? await appState.bridgeClient.sendCommand(
                action: "chat:send",
                payload: [
                    "projectId": appState.currentProjectId ?? "",
                    "message": text
                ]
            )
        }
    }
}

// 连接状态条
struct ConnectionStatusBar: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        switch appState.connectionState {
        case .connected:
            EmptyView()
        case .connecting:
            statusBar(text: "正在连接...", color: .orange)
        case .reconnecting:
            statusBar(text: "重新连接中...", color: .orange)
        case .disconnected:
            statusBar(text: "已断开连接", color: .red)
        }
    }

    private func statusBar(text: String, color: Color) -> some View {
        HStack {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(text).font(.caption)
            Spacer()
            Button("重连") { appState.connect() }
                .font(.caption)
                .foregroundColor(.blue)
        }
        .padding(.horizontal)
        .padding(.vertical, 6)
        .background(color.opacity(0.1))
    }
}

// 消息气泡
struct MessageBubbleView: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer() }

            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                // 思考块
                if let thinking = message.thinkingContent, !thinking.isEmpty {
                    DisclosureGroup("思考过程") {
                        Text(thinking)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .padding(8)
                            .background(Color(.systemGray6))
                            .cornerRadius(8)
                    }
                    .font(.caption)
                }

                // 工具调用
                ForEach(message.toolCalls) { tool in
                    HStack(spacing: 4) {
                        Image(systemName: tool.status == .completed ? "checkmark.circle" : "arrow.triangle.2.circlepath")
                            .foregroundColor(tool.status == .completed ? .green : .orange)
                        Text(tool.name)
                            .font(.caption)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color(.systemGray5))
                    .cornerRadius(6)
                }

                // 消息内容
                Text(message.content)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(message.role == .user ? Color.blue : Color(.systemGray6))
                    .foregroundColor(message.role == .user ? .white : .primary)
                    .cornerRadius(12)
            }

            if message.role == .assistant { Spacer() }
        }
    }
}
