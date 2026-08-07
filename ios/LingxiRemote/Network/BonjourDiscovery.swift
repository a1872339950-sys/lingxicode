import Foundation
import Network

class BonjourDiscovery: NSObject, ObservableObject {
    @Published var discoveredServices: [DiscoveredService] = []

    private var browser: NWBrowser?

    struct DiscoveredService: Identifiable {
        let id = UUID()
        let name: String
        let host: String
        let port: Int
    }

    func startSearching() {
        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: "_lingxi-bridge._tcp", domain: nil), using: parameters)

        browser?.stateUpdateHandler = { state in
            // Handle browser state changes
        }

        browser?.browseResultsChangedHandler = { [weak self] results, changes in
            var services: [DiscoveredService] = []
            for result in results {
                if case .service(let name, _, _, _) = result.endpoint {
                    // 解析 host 和 port
                    let hostPort = Self.extractHostPort(from: result.endpoint)
                    if let host = hostPort?.host, let port = hostPort?.port {
                        services.append(DiscoveredService(name: name, host: host, port: port))
                    }
                }
            }
            DispatchQueue.main.async {
                self?.discoveredServices = services
            }
        }

        browser?.start(queue: .main)
    }

    func stopSearching() {
        browser?.cancel()
        browser = nil
    }

    private static func extractHostPort(from endpoint: NWEndpoint) -> (host: String, port: Int)? {
        switch endpoint {
        case .hostPort(let host, let port):
            return (host.debugDescription, Int(port.rawValue))
        default:
            return nil
        }
    }
}
