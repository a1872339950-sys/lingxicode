import SwiftUI
import Combine

@MainActor
class AppState: ObservableObject {
    @Published var connectionState: ConnectionState = .disconnected
    @Published var isPaired: Bool = false
    @Published var pairedToken: String?
    @Published var serverAddress: String = ""
    @Published var serverPort: Int = 9876
    @Published var deviceName: String = UIDevice.current.name
    @Published var currentProjectId: String?
    @Published var projects: [Project] = []
    @Published var messages: [ChatMessage] = []
    @Published var aiStatus: AIStatus = .idle

    let bridgeClient = BridgeClient()

    init() {
        // 从 Keychain 恢复 token
        if let token = KeychainStore.load(key: "pairedToken") {
            self.pairedToken = token
            self.isPaired = true
        }
        if let address = UserDefaults.standard.string(forKey: "serverAddress") {
            self.serverAddress = address
        }
        setupBridgeClient()
    }

    private func setupBridgeClient() {
        bridgeClient.onStateChange = { [weak self] state in
            Task { @MainActor in
                self?.connectionState = state
            }
        }
        bridgeClient.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handleEvent(event)
            }
        }
    }

    private func handleEvent(_ event: BridgeEvent) {
        switch event.channel {
        case "ai-status":
            if let status = event.data["status"] as? String {
                aiStatus = AIStatus(rawValue: status) ?? .idle
            }
        case "ai-final-delta":
            // 追加流式内容
            let delta = event.data["delta"] as? String ?? event.data["content"] as? String ?? ""
            if !delta.isEmpty,
               let lastMsg = messages.last, lastMsg.role == .assistant {
                messages[messages.count - 1].content += delta
            } else if !delta.isEmpty {
                messages.append(ChatMessage(role: .assistant, content: delta))
            }
        case "ai-thinking":
            let text = event.data["content"] as? String ?? event.data["summary"] as? String ?? ""
            guard !text.isEmpty else { break }
            ensureAssistantMessage()
            if let existing = messages[messages.count - 1].thinkingContent, !existing.isEmpty {
                messages[messages.count - 1].thinkingContent = existing + text
            } else {
                messages[messages.count - 1].thinkingContent = text
            }
        case "ai-thinking-reset":
            break
        case "message-reply":
            // AI 回复完成
            if let content = event.data["content"] as? String, !content.isEmpty {
                if messages.last?.role == .assistant {
                    messages[messages.count - 1].content = content
                } else {
                    let msg = ChatMessage(role: .assistant, content: content)
                    messages.append(msg)
                }
            }
            if let status = event.data["error"] as? Bool, status {
                aiStatus = .error
            } else if event.data["done"] as? Bool == true {
                aiStatus = .idle
            }
        case "tool-start", "tool-result":
            handleToolEvent(channel: event.channel, data: event.data)
        default:
            break
        }
    }

    private func ensureAssistantMessage() {
        if messages.last?.role != .assistant {
            messages.append(ChatMessage(role: .assistant, content: ""))
        }
    }

    private func handleToolEvent(channel: String, data: [String: Any]) {
        ensureAssistantMessage()
        let remoteId = data["toolId"] as? String ?? data["id"] as? String ?? data["toolCallId"] as? String
        let name = data["toolName"] as? String ?? data["name"] as? String ?? data["tool"] as? String ?? "工具调用"
        let isResult = channel == "tool-result"
        let statusText = (data["status"] as? String ?? "").lowercased()
        let status: ToolCall.Status = (!isResult || statusText == "running") ? .running : ((data["error"] != nil || statusText == "error") ? .failed : .completed)
        let result = data["message"] as? String ?? data["error"] as? String ?? data["content"] as? String

        if let remoteId,
           let index = messages[messages.count - 1].toolCalls.lastIndex(where: { $0.remoteId == remoteId }) {
            messages[messages.count - 1].toolCalls[index].status = status
            if let result { messages[messages.count - 1].toolCalls[index].result = result }
        } else {
            messages[messages.count - 1].toolCalls.append(ToolCall(remoteId: remoteId, name: name, status: status, result: result))
        }
    }

    func connect() {
        guard let token = pairedToken, !serverAddress.isEmpty else { return }
        bridgeClient.connect(host: serverAddress, port: serverPort, token: token)
    }

    func disconnect() {
        bridgeClient.disconnect()
    }

    func pair(pin: String, deviceName: String) async throws -> Bool {
        guard !serverAddress.isEmpty else { return false }
        bridgeClient.connect(host: serverAddress, port: serverPort, token: nil)

        // 等待连接建立
        try await Task.sleep(nanoseconds: 500_000_000)

        let result = try await bridgeClient.sendCommand(action: "remote:auth", payload: [
            "pin": pin,
            "deviceName": deviceName
        ])

        if let token = result["token"] as? String {
            self.pairedToken = token
            self.isPaired = true
            KeychainStore.save(key: "pairedToken", value: token)
            UserDefaults.standard.set(serverAddress, forKey: "serverAddress")
            return true
        }
        return false
    }
}

enum ConnectionState: String {
    case disconnected
    case connecting
    case connected
    case reconnecting
}

enum AIStatus: String {
    case idle
    case thinking
    case streaming
    case error
    case interrupted
}
