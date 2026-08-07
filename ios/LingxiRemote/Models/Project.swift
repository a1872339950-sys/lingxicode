import Foundation

struct Project: Identifiable, Equatable {
    let id: String
    let name: String
    let path: String
    var currentBranch: String?
    var lastActiveAt: Date?

    var displayName: String {
        name.isEmpty ? path.components(separatedBy: "/").last ?? path : name
    }

    static func fromDictionary(_ raw: [String: Any]) -> Project? {
        let id = raw["id"] as? String ?? raw["projectId"] as? String ?? raw["path"] as? String ?? ""
        guard !id.isEmpty else { return nil }
        return Project(
            id: id,
            name: raw["name"] as? String ?? raw["title"] as? String ?? "",
            path: raw["path"] as? String ?? raw["projectPath"] as? String ?? "",
            currentBranch: raw["branchName"] as? String ?? (raw["gitStatus"] as? [String: Any])?["branch"] as? String,
            lastActiveAt: Project.parseDate(raw["updatedAt"] ?? raw["lastOpenedAt"] ?? raw["lastActiveAt"])
        )
    }

    private static func parseDate(_ value: Any?) -> Date? {
        if let time = value as? TimeInterval, time > 0 {
            return Date(timeIntervalSince1970: time > 10_000_000_000 ? time / 1000 : time)
        }
        if let intValue = value as? Int, intValue > 0 {
            let time = TimeInterval(intValue)
            return Date(timeIntervalSince1970: time > 10_000_000_000 ? time / 1000 : time)
        }
        if let text = value as? String {
            return ISO8601DateFormatter().date(from: text)
        }
        return nil
    }
}
