import SwiftUI

struct PairingView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var discovery = BonjourDiscovery()

    @State private var ipAddress: String = ""
    @State private var pinCode: String = ""
    @State private var isPairing: Bool = false
    @State private var errorMessage: String?
    @State private var showManualInput: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Logo + 标题
                    VStack(spacing: 8) {
                        Image(systemName: "antenna.radiowaves.left.and.right")
                            .font(.system(size: 48))
                            .foregroundColor(.blue)
                        Text("灵犀遥控")
                            .font(.largeTitle)
                            .fontWeight(.bold)
                        Text("连接你的桌面端灵犀")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .padding(.top, 40)

                    // 自动发现的设备
                    if !discovery.discoveredServices.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("发现的设备")
                                .font(.headline)
                            ForEach(discovery.discoveredServices) { service in
                                Button {
                                    ipAddress = service.host
                                    appState.serverAddress = service.host
                                    appState.serverPort = service.port
                                } label: {
                                    HStack {
                                        Image(systemName: "desktopcomputer")
                                        VStack(alignment: .leading) {
                                            Text(service.name).font(.body)
                                            Text("\(service.host):\(service.port)")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                        Spacer()
                                        if ipAddress == service.host {
                                            Image(systemName: "checkmark.circle.fill")
                                                .foregroundColor(.blue)
                                        }
                                    }
                                    .padding()
                                    .background(Color(.systemGray6))
                                    .cornerRadius(12)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    // 手动输入
                    VStack(spacing: 16) {
                        TextField("服务器 IP 地址", text: $ipAddress)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.decimalPad)
                            .autocapitalization(.none)
                            .onChange(of: ipAddress) { _, newValue in
                                appState.serverAddress = newValue
                            }

                        TextField("6位配对码", text: $pinCode)
                            .textFieldStyle(.roundedBorder)
                            .keyboardType(.numberPad)
                            .multilineTextAlignment(.center)
                            .font(.title2)

                        if let error = errorMessage {
                            Text(error)
                                .font(.caption)
                                .foregroundColor(.red)
                        }

                        Button {
                            Task {
                                isPairing = true
                                errorMessage = nil
                                do {
                                    let success = try await appState.pair(
                                        pin: pinCode,
                                        deviceName: appState.deviceName
                                    )
                                    if !success {
                                        errorMessage = "配对失败，请检查PIN码"
                                    }
                                } catch {
                                    errorMessage = error.localizedDescription
                                }
                                isPairing = false
                            }
                        } label: {
                            HStack {
                                if isPairing {
                                    ProgressView()
                                        .tint(.white)
                                }
                                Text("配对连接")
                                    .fontWeight(.semibold)
                            }
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(ipAddress.isEmpty || pinCode.count != 6 ? Color.gray : Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(12)
                        }
                        .disabled(ipAddress.isEmpty || pinCode.count != 6 || isPairing)
                    }
                    .padding(.horizontal)

                    Spacer()
                }
            }
            .onAppear {
                discovery.startSearching()
            }
            .onDisappear {
                discovery.stopSearching()
            }
        }
    }
}
