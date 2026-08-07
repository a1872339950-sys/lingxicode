import Foundation
import Combine

class BridgeClient: NSObject, ObservableObject {
    private var webSocketTask: URLSessionWebSocketTask?
    private var session: URLSession?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 10
    private var reconnectTimer: Timer?
    private var host: String = ""
    private var port: Int = 9876
    private var token: String?
    private var pendingRequests: [String: CheckedContinuation<[String: Any], Error>] = [:]

    var onStateChange: ((ConnectionState) -> Void)?
    var onEvent: ((BridgeEvent) -> Void)?

    func connect(host: String, port: Int, token: String?) {
        self.host = host
        self.port = port
        self.token = token

        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)

        var urlString = "ws://\(host):\(port)"
        if let token = token {
            urlString += "?token=\(token)"
        }

        guard let url = URL(string: urlString) else { return }

        onStateChange?(.connecting)
        webSocketTask = session?.webSocketTask(with: url)
        webSocketTask?.resume()
        receiveMessage()
    }

    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        reconnectAttempts = 0
        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil
        onStateChange?(.disconnected)
    }

    func sendCommand(action: String, payload: [String: Any] = [:]) async throws -> [String: Any] {
        let requestId = "req_\(UUID().uuidString.prefix(8))"
        let message: [String: Any] = [
            "id": requestId,
            "type": "command",
            "action": action,
            "payload": payload
        ]

        let data = try JSONSerialization.data(withJSONObject: message)
        guard let json = String(data: data, encoding: .utf8) else {
            throw BridgeError.encodingFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            pendingRequests[requestId] = continuation
            webSocketTask?.send(.string(json)) { [weak self] error in
                if let error = error {
                    self?.pendingRequests.removeValue(forKey: requestId)
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                self?.handleReceivedMessage(message)
                self?.receiveMessage() // 继续接收
            case .failure:
                self?.handleDisconnect()
            }
        }
    }

    private func handleReceivedMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            guard let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            processJSON(json)
        case .data(let data):
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            processJSON(json)
        @unknown default:
            break
        }
    }

    private func processJSON(_ json: [String: Any]) {
        guard let type = json["type"] as? String else { return }

        switch type {
        case "response":
            if let id = json["id"] as? String,
               let continuation = pendingRequests.removeValue(forKey: id) {
                if let success = json["success"] as? Bool, success {
                    let data = json["data"] as? [String: Any] ?? [:]
                    continuation.resume(returning: data)
                } else {
                    let error = json["error"] as? String ?? "Unknown error"
                    continuation.resume(throwing: BridgeError.commandFailed(error))
                }
            }
        case "event":
            if let channel = json["channel"] as? String {
                let data = json["data"] as? [String: Any] ?? [:]
                onEvent?(BridgeEvent(channel: channel, data: data))
            }
        case "pong":
            break // 心跳响应
        case "connected":
            onStateChange?(.connected)
            reconnectAttempts = 0
        default:
            break
        }
    }

    private func handleDisconnect() {
        // 取消所有挂起的请求，防止 continuation 泄漏
        for (_, continuation) in pendingRequests {
            continuation.resume(throwing: BridgeError.notConnected)
        }
        pendingRequests.removeAll()

        onStateChange?(.disconnected)
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        guard reconnectAttempts < maxReconnectAttempts else { return }

        let delay = min(pow(2.0, Double(reconnectAttempts)), 30.0)
        reconnectAttempts += 1
        onStateChange?(.reconnecting)

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            self.connect(host: self.host, port: self.port, token: self.token)
        }
    }
}

extension BridgeClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        onStateChange?(.connected)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        handleDisconnect()
    }
}

struct BridgeEvent {
    let channel: String
    let data: [String: Any]
}

enum BridgeError: Error, LocalizedError {
    case encodingFailed
    case commandFailed(String)
    case notConnected

    var errorDescription: String? {
        switch self {
        case .encodingFailed: return "消息编码失败"
        case .commandFailed(let msg): return "命令失败: \(msg)"
        case .notConnected: return "未连接到服务器"
        }
    }
}
