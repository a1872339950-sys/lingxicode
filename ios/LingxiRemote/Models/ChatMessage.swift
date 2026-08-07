import Foundation

struct ChatMessage: Identifiable, Equatable {
    let id: UUID
    let role: Role
    var content: String
    var thinkingContent: String?
    var toolCalls: [ToolCall]
    var timestamp: Date

    init(id: UUID = UUID(), role: Role, content: String, thinkingContent: String? = nil, toolCalls: [ToolCall] = [], timestamp: Date = Date()) {
        self.id = id
        self.role = role
        self.content = content
        self.thinkingContent = thinkingContent
        self.toolCalls = toolCalls
        self.timestamp = timestamp
    }

    enum Role: String {
        case user
        case assistant
        case system
    }

    static func fromDictionary(_ raw: [String: Any]) -> ChatMessage? {
        let rawRole = (raw["role"] as? String ?? raw["type"] as? String ?? "assistant").lowercased()
        let role: Role = rawRole == "user" ? .user : (rawRole == "system" ? .system : .assistant)
        let content = raw["displayContent"] as? String
            ?? raw["content"] as? String
            ?? raw["message"] as? String
            ?? raw["text"] as? String
            ?? ""
        let thinking = raw["thinkingContent"] as? String
            ?? raw["thinking"] as? String
            ?? raw["reasoning"] as? String
        let toolCalls = ChatMessage.parseToolCalls(raw)
        return ChatMessage(role: role, content: content, thinkingContent: thinking, toolCalls: toolCalls)
    }

    private static func parseToolCalls(_ raw: [String: Any]) -> [ToolCall] {
        let candidates = raw["toolCalls"] as? [[String: Any]]
            ?? raw["tools"] as? [[String: Any]]
            ?? raw["operations"] as? [[String: Any]]
            ?? []
        return candidates.map { item in
            let name = item["name"] as? String ?? item["toolName"] as? String ?? item["title"] as? String ?? "工具调用"
            let remoteId = item["id"] as? String ?? item["toolId"] as? String ?? item["toolCallId"] as? String
            let statusText = (item["status"] as? String ?? "completed").lowercased()
            let status: ToolCall.Status = statusText == "running" ? .running : (statusText == "error" || statusText == "failed" ? .failed : .completed)
            let result = item["content"] as? String ?? item["summary"] as? String ?? item["message"] as? String
            return ToolCall(remoteId: remoteId, name: name, status: status, result: result)
        }
    }
}

struct ToolCall: Identifiable, Equatable {
    let id: UUID
    let remoteId: String?
    let name: String
    var status: Status
    var result: String?

    init(id: UUID = UUID(), remoteId: String? = nil, name: String, status: Status = .running, result: String? = nil) {
        self.id = id
        self.remoteId = remoteId
        self.name = name
        self.status = status
        self.result = result
    }

    enum Status: String {
        case running
        case completed
        case failed
    }
}
