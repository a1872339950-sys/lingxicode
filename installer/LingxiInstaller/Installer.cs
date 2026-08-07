using Microsoft.Win32;
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using WinForms = System.Windows.Forms;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using Ellipse = System.Windows.Shapes.Ellipse;
using PathShape = System.Windows.Shapes.Path;

namespace LingxiInstaller
{
    internal sealed class WebGlSceneHost
    {
        private readonly WebView2 browser;
        private readonly Grid root;
        private readonly UIElement fallback;
        private bool ready;
        private double progress;
        private string state = "install";

        public WebGlSceneHost(double width, double height)
        {
            root = new Grid { Width = width, Height = height, HorizontalAlignment = HorizontalAlignment.Center };
            fallback = CreateFallback();
            root.Children.Add(fallback);
            browser = new WebView2 { Width = width, Height = height, HorizontalAlignment = HorizontalAlignment.Center, Visibility = Visibility.Hidden };
            browser.Loaded += Initialize;
            browser.NavigationCompleted += OnNavigationCompleted;
            root.Children.Add(browser);
        }

        public UIElement View { get { return root; } }

        public void SetState(double value, string nextState)
        {
            progress = Math.Max(0, Math.Min(100, value));
            state = nextState ?? "install";
            if (!ready) return;
            try { browser.ExecuteScriptAsync("window.setInstallerState(" + (progress / 100.0).ToString(System.Globalization.CultureInfo.InvariantCulture) + ",'" + state.Replace("'", string.Empty) + "')"); } catch { }
        }

        private async void Initialize(object sender, RoutedEventArgs e)
        {
            try
            {
                var cachePath = Path.Combine(Path.GetTempPath(), "LingxiInstallerWebView2");
                var environment = await CoreWebView2Environment.CreateAsync(null, cachePath);
                await browser.EnsureCoreWebView2Async(environment);
                browser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                browser.CoreWebView2.Settings.AreDevToolsEnabled = false;
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("LingxiPayload.webgl-scene.html"))
                using (var reader = stream == null ? null : new StreamReader(stream, System.Text.Encoding.UTF8))
                {
                    if (reader == null) return;
                    browser.NavigateToString(reader.ReadToEnd());
                }
            }
            catch { }
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess) return;
            ready = true;
            SetState(progress, state);
            browser.Visibility = Visibility.Visible;
            browser.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260)));
            fallback.BeginAnimation(UIElement.OpacityProperty, new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(220)));
        }

        private static UIElement CreateFallback()
        {
            var root = new Grid { Width = 196, Height = 176, IsHitTestVisible = false, RenderTransformOrigin = new Point(.5, .5) };
            var glow = new RadialGradientBrush(Color.FromArgb(55, 56, 189, 248), Color.FromArgb(0, 15, 23, 42));
            root.Children.Add(new Ellipse { Width = 152, Height = 132, Fill = glow, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center });
            var geometry = Geometry.Parse("M 32,57 L 108,20 L 157,48 L 166,145 L 112,96 L 32,57 M 43,104 L 91,83 L 137,31 L 157,48 L 111,151 L 43,104 M 43,104 L 91,139 L 111,151 L 166,145 L 112,96 L 43,104");
            var mark = new PathShape
            {
                Data = geometry,
                Fill = Brushes.Transparent,
                Stroke = new LinearGradientBrush(Color.FromRgb(235, 243, 255), Color.FromRgb(105, 164, 230), new Point(0, 0), new Point(1, 1)),
                StrokeThickness = 7,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
                Effect = new System.Windows.Media.Effects.DropShadowEffect { Color = Color.FromRgb(96, 165, 250), BlurRadius = 14, ShadowDepth = 0, Opacity = .68 }
            };
            root.Children.Add(mark);
            var scale = new ScaleTransform(1, 1); root.RenderTransform = scale;
            var breathe = new DoubleAnimation(1, 1.025, TimeSpan.FromSeconds(2.2)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, breathe); scale.BeginAnimation(ScaleTransform.ScaleYProperty, breathe);
            return root;
        }
    }

    public class InstallerApp : System.Windows.Application
    {
        [STAThread]
        public static void Main(string[] args)
        {
#if UNINSTALLER
            if (args != null && args.Length >= 2 && string.Equals(args[0], "--cleanup-install-dir", StringComparison.OrdinalIgnoreCase))
            {
                CleanupInstallDir(args);
                return;
            }
#endif
            var app = new InstallerApp();
#if UNINSTALLER
            // 支持静默卸载模式，Windows 设置的卸载按钮会调用 QuietUninstallString
            bool silentMode = args != null && Array.Exists(args, a => string.Equals(a, "--silent", StringComparison.OrdinalIgnoreCase));
            var uninstallWindow = new UninstallWindow(silentMode);
            if (silentMode)
            {
                // 静默模式：不显示窗口，直接执行卸载后退出
                uninstallWindow.Loaded += async (s, e) =>
                {
                    await uninstallWindow.ExecuteSilentUninstall();
                    app.Shutdown();
                };
            }
            app.Run(uninstallWindow);
#else
            app.Run(new InstallWindow());
#endif
        }

#if UNINSTALLER
        private static void CleanupInstallDir(string[] args)
        {
            var installDir = args.Length > 1 ? args[1] : "";
            var parentPid = 0;
            if (args.Length > 2) int.TryParse(args[2], out parentPid);
            if (string.IsNullOrWhiteSpace(installDir) || !PathRules.IsSafeInstallDirDeleteTarget(installDir)) return;

            WaitForProcessExit(parentPid, TimeSpan.FromSeconds(20));
            CloseRunningAppProcesses(installDir);
            DeleteDirectoryWithRetries(installDir, 60, TimeSpan.FromMilliseconds(500));
        }

        private static void WaitForProcessExit(int pid, TimeSpan timeout)
        {
            if (pid <= 0) return;
            try
            {
                var process = Process.GetProcessById(pid);
                process.WaitForExit((int)Math.Max(0, timeout.TotalMilliseconds));
            }
            catch { }
        }

        private static void CloseRunningAppProcesses(string installDir)
        {
            var processName = Path.GetFileNameWithoutExtension(InstallerConstants.AppExe);
            foreach (var process in Process.GetProcessesByName(processName))
            {
                try
                {
                    var path = "";
                    try { path = process.MainModule == null ? "" : process.MainModule.FileName; } catch { }
                    if (!PathRules.IsInsideDirectory(installDir, path)) continue;

                    try { process.CloseMainWindow(); } catch { }
                    if (!process.WaitForExit(2500))
                    {
                        try { process.Kill(); } catch { }
                    }
                    try { process.WaitForExit(2500); } catch { }
                }
                catch { }
                finally
                {
                    try { process.Dispose(); } catch { }
                }
            }
        }

        private static bool DeleteDirectoryWithRetries(string dir, int attempts, TimeSpan delay)
        {
            for (var i = 0; i < attempts; i++)
            {
                try
                {
                    if (!Directory.Exists(dir)) return true;
                    Directory.Delete(dir, true);
                    if (!Directory.Exists(dir)) return true;
                }
                catch { }

                try { System.Threading.Thread.Sleep(delay); } catch { }
            }
            return !Directory.Exists(dir);
        }
#endif
    }

    public static class InstallerConstants
    {
        public const string AppName = "灵犀 LingXiCode";
        public const string AppVersion = "1.0.0";
        public const string AppExe = "lingxi-lingxicode.exe";
        public const string UninstallerExe = "LingxiUninstall.exe";
        public const string DataPointerFile = "lingxi-data-dir.txt";
        public const string StateDirName = "Lingxi LingXiCode";
        public const string RegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi LingXiCode";
        public const string RegistryKeyWow6432 = @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Lingxi LingXiCode";
    }

    public static class PathRules
    {
        public static string DefaultInstallDir()
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            return Path.Combine(local, "Programs", "lingxi-lingxicode");
        }

        public static string DefaultDataDir(string installDir)
        {
            return Path.Combine(StateDir(), "data");
        }

        public static string StateDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), InstallerConstants.StateDirName);
        }

        public static string DataMarkerPath()
        {
            return Path.Combine(StateDir(), InstallerConstants.DataPointerFile);
        }

        public static string ReadRememberedDataDir()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(InstallerConstants.RegistryKey))
                {
                    var value = key == null ? "" : Convert.ToString(key.GetValue("LingxiDataDir", ""));
                    if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
                }
            }
            catch { }

            try
            {
                var marker = DataMarkerPath();
                if (File.Exists(marker))
                {
                    var value = File.ReadAllText(marker, System.Text.Encoding.UTF8).Trim();
                    if (!string.IsNullOrWhiteSpace(value)) return value;
                }
            }
            catch { }

            return DefaultDataDir("");
        }

        public static void WriteDataMarker(string dataDir)
        {
            if (string.IsNullOrWhiteSpace(dataDir)) return;
            Directory.CreateDirectory(StateDir());
            File.WriteAllText(DataMarkerPath(), dataDir.Trim(), System.Text.Encoding.UTF8);
        }

        public static void DeleteDataMarker()
        {
            try
            {
                var marker = DataMarkerPath();
                if (File.Exists(marker)) File.Delete(marker);
                var stateDir = StateDir();
                if (Directory.Exists(stateDir) && !Directory.EnumerateFileSystemEntries(stateDir).Any()) Directory.Delete(stateDir);
            }
            catch { }
        }

        public static bool IsInsideDirectory(string parent, string child)
        {
            if (string.IsNullOrWhiteSpace(parent) || string.IsNullOrWhiteSpace(child)) return false;
            var parentFull = Path.GetFullPath(parent).TrimEnd('\\') + "\\";
            var childFull = Path.GetFullPath(child).TrimEnd('\\') + "\\";
            return childFull.StartsWith(parentFull, StringComparison.OrdinalIgnoreCase);
        }

        public static string UserApiConfigDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".lingxicode");
        }

        private static string NormalizeForCompare(string path)
        {
            return Path.GetFullPath(path).TrimEnd('\\');
        }

        private static bool IsSamePath(string left, string right)
        {
            if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right)) return false;
            return string.Equals(NormalizeForCompare(left), NormalizeForCompare(right), StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsSameOrInsideDirectory(string parent, string child)
        {
            if (string.IsNullOrWhiteSpace(parent) || string.IsNullOrWhiteSpace(child)) return false;
            return IsSamePath(parent, child) || IsInsideDirectory(parent, child);
        }

        public static bool IsSafeDeleteTarget(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return false;
            var full = NormalizeForCompare(path.Trim());
            var root = Path.GetPathRoot(full);
            if (string.Equals(full, root == null ? "" : root.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) return false;
            var windows = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (!string.IsNullOrEmpty(windows) && IsSameOrInsideDirectory(windows, full)) return false;

            var dangerousExactDirs = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
            };
            foreach (var dir in dangerousExactDirs)
            {
                if (!string.IsNullOrWhiteSpace(dir) && IsSamePath(full, dir)) return false;
            }

            if (string.IsNullOrWhiteSpace(Path.GetFileName(full))) return false;
            return true;
        }

        public static bool IsSafeInstallDirDeleteTarget(string path)
        {
            if (!IsSafeDeleteTarget(path)) return false;
            var full = NormalizeForCompare(path.Trim());
            return File.Exists(Path.Combine(full, InstallerConstants.AppExe))
                || File.Exists(Path.Combine(full, InstallerConstants.UninstallerExe))
                || File.Exists(Path.Combine(full, InstallerConstants.DataPointerFile));
        }
    }

    public static class Ui
    {
        public static Button Button(string text, Brush bg, Brush fg)
        {
            return new Button
            {
                Content = text,
                Height = 36,
                MinWidth = 104,
                Padding = new Thickness(15, 0, 15, 0),
                Background = bg,
                Foreground = fg,
                BorderThickness = new Thickness(0),
                FontSize = 14,
                FontWeight = FontWeights.SemiBold,
                Cursor = System.Windows.Input.Cursors.Hand
            };
        }

        public static TextBlock Text(string text, double size, Brush color, FontWeight weight)
        {
            return new TextBlock
            {
                Text = text,
                FontSize = size,
                Foreground = color,
                FontWeight = weight,
                TextWrapping = TextWrapping.Wrap,
                VerticalAlignment = VerticalAlignment.Center
            };
        }

        public static TextBox PathBox(string text)
        {
            return new TextBox
            {
                Text = text,
                Height = 32,
                FontSize = 13,
                Padding = new Thickness(10, 6, 10, 6),
                BorderBrush = new SolidColorBrush(Color.FromRgb(214, 222, 235)),
                Background = Brushes.White,
                VerticalContentAlignment = VerticalAlignment.Center
            };
        }

        public static Border Card(UIElement child)
        {
            return new Border
            {
                Child = child,
                Background = Brushes.White,
                CornerRadius = new CornerRadius(14),
                Padding = new Thickness(18),
                BorderBrush = new SolidColorBrush(Color.FromRgb(226, 232, 240)),
                BorderThickness = new Thickness(1),
                Effect = new System.Windows.Media.Effects.DropShadowEffect
                {
                    BlurRadius = 22,
                    ShadowDepth = 5,
                    Opacity = 0.075,
                    Color = Colors.Black
                }
            };
        }

        public static string PickFolder(string title, string selected)
        {
            using (var dialog = new WinForms.FolderBrowserDialog())
            {
                dialog.Description = title;
                dialog.SelectedPath = Directory.Exists(selected) ? selected : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                dialog.ShowNewFolderButton = true;
                return dialog.ShowDialog() == WinForms.DialogResult.OK ? dialog.SelectedPath : null;
            }
        }
    }

#if !UNINSTALLER
    public class InstallWindow : Window
    {
        private TextBox installPath;
        private TextBox dataPath;
        private CheckBox desktopShortcut;
        private CheckBox startShortcut;
        private CheckBox launchAfterInstall;
        private Grid progressTrack;
        private Border progressFill;
        private Border progressShine;
        private TextBlock progressPercent;
        private double currentProgressValue;
        private WebGlSceneHost webGlScene;
        private TextBlock status;
        private Button installButton;
        private bool dataPathTouched;

        public InstallWindow()
        {
            Title = InstallerConstants.AppName + " 安装";
            Width = 900;
            Height = 548;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ResizeMode = ResizeMode.NoResize;
            Background = new SolidColorBrush(Color.FromRgb(244, 247, 251));
            Icon = LoadIcon();
            Build();
        }

        private ImageSource LoadIcon()
        {
            try
            {
                var iconPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "灵犀logo.ico");
                if (File.Exists(iconPath)) return BitmapFrame.Create(new Uri(iconPath));
            }
            catch { }
            return null;
        }

        private void Build()
        {
            var root = new Grid();
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(286) });
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var brand = CreateBrandPanel("安装向导", "", "软件与数据位置可分别设置。升级或卸载时，项目数据默认受到保护。", Color.FromRgb(37, 99, 235));
            Grid.SetColumn(brand, 0);
            root.Children.Add(brand);

            var content = new StackPanel { Margin = new Thickness(34, 28, 34, 22) };
            Grid.SetColumn(content, 1);
            content.Children.Add(Ui.Text("安装 " + InstallerConstants.AppName, 25, new SolidColorBrush(Color.FromRgb(20, 30, 48)), FontWeights.Bold));
            content.Children.Add(new TextBlock { Text = "确认安装位置与使用偏好", Margin = new Thickness(0, 7, 0, 20), FontSize = 13, Foreground = new SolidColorBrush(Color.FromRgb(88, 101, 125)) });

            var form = new StackPanel();
            form.Children.Add(Ui.Text("软件安装位置", 14, new SolidColorBrush(Color.FromRgb(30, 41, 59)), FontWeights.Bold));
            form.Children.Add(PathRow(out installPath, PathRules.DefaultInstallDir(), () => BrowseInstall()));
            form.Children.Add(Ui.Text("数据存储位置", 14, new SolidColorBrush(Color.FromRgb(30, 41, 59)), FontWeights.Bold));
            form.Children.Add(PathRow(out dataPath, PathRules.ReadRememberedDataDir(), () => BrowseData()));
            form.Children.Add(new TextBlock { Text = "项目列表、上下文、账本、缓存、记忆会保存在这里，推荐安装在空间充足的系统盘。", Margin = new Thickness(0, 4, 0, 8), FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)), TextWrapping = TextWrapping.Wrap });

            installPath.TextChanged += (s, e) =>
            {
                if (!dataPathTouched) dataPath.Text = PathRules.DefaultDataDir(installPath.Text.Trim());
            };
            dataPath.TextChanged += (s, e) => { if (dataPath.IsKeyboardFocusWithin) dataPathTouched = true; };

            var options = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, Margin = new Thickness(0, 0, 0, 4) };
            desktopShortcut = new CheckBox { Content = "桌面快捷方式", IsChecked = true, Margin = new Thickness(0, 0, 20, 0), FontSize = 13 };
            startShortcut = new CheckBox { Content = "开始菜单快捷方式", IsChecked = true, Margin = new Thickness(0, 0, 20, 0), FontSize = 13 };
            launchAfterInstall = new CheckBox { Content = "安装完成后启动", IsChecked = true, FontSize = 13 };
            options.Children.Add(desktopShortcut);
            options.Children.Add(startShortcut);
            options.Children.Add(launchAfterInstall);
            form.Children.Add(options);

            content.Children.Add(Ui.Card(form));

            content.Children.Add(CreateProgressVisual());

            var actions = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, HorizontalAlignment = System.Windows.HorizontalAlignment.Right };
            var cancel = Ui.Button("取消", new SolidColorBrush(Color.FromRgb(226, 232, 240)), new SolidColorBrush(Color.FromRgb(30, 41, 59)));
            cancel.Click += (s, e) => Close();
            installButton = Ui.Button("开始安装", new SolidColorBrush(Color.FromRgb(37, 99, 235)), Brushes.White);
            installButton.Margin = new Thickness(12, 0, 0, 0);
            installButton.Click += async (s, e) => await InstallAsync();
            actions.Children.Add(cancel);
            actions.Children.Add(installButton);
            content.Children.Add(actions);

            root.Children.Add(content);
            Content = root;
        }

        private Border CreateBrandPanel(string eyebrow, string badge, string description, Color accent)
        {
            var panel = new Grid { Margin = new Thickness(32, 34, 30, 30) };
            panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            panel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

            var heading = new StackPanel();
            heading.Children.Add(new TextBlock { Text = eyebrow.ToUpperInvariant(), FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(125, 211, 252)) });
            heading.Children.Add(Ui.Text(InstallerConstants.AppName, 25, Brushes.White, FontWeights.Bold));
            heading.Children.Add(new TextBlock { Text = "桌面端 AI 工作空间", Margin = new Thickness(0, 6, 0, 0), FontSize = 13, Foreground = new SolidColorBrush(Color.FromRgb(186, 201, 224)) });
            panel.Children.Add(heading);

            var center = new StackPanel { VerticalAlignment = VerticalAlignment.Center, HorizontalAlignment = System.Windows.HorizontalAlignment.Center };
            webGlScene = new WebGlSceneHost(196, 176);
            center.Children.Add(webGlScene.View);
            if (!string.IsNullOrWhiteSpace(badge))
            {
                var badgeBorder = new Border { Margin = new Thickness(0, 20, 0, 0), Padding = new Thickness(12, 6, 12, 6), CornerRadius = new CornerRadius(12), Background = new SolidColorBrush(Color.FromArgb(34, accent.R, accent.G, accent.B)), BorderBrush = new SolidColorBrush(Color.FromArgb(72, accent.R, accent.G, accent.B)), BorderThickness = new Thickness(1) };
                badgeBorder.Child = new TextBlock { Text = badge, FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(219, 234, 254)) };
                center.Children.Add(badgeBorder);
            }
            Grid.SetRow(center, 1);
            panel.Children.Add(center);

            var footer = new StackPanel();
            footer.Children.Add(new Border { Height = 1, Margin = new Thickness(0, 0, 0, 15), Background = new SolidColorBrush(Color.FromArgb(38, 255, 255, 255)) });
            footer.Children.Add(new TextBlock { Text = description, FontSize = 12, LineHeight = 19, Foreground = new SolidColorBrush(Color.FromRgb(174, 190, 214)), TextWrapping = TextWrapping.Wrap });
            Grid.SetRow(footer, 2);
            panel.Children.Add(footer);

            return new Border { Background = new LinearGradientBrush(Color.FromRgb(13, 28, 51), Color.FromRgb(20, 45, 74), new Point(0, 0), new Point(1, 1)), Child = panel };
        }

        private Grid CreateLogoOrb()
        {
            var root = new Grid
            {
                Width = 76,
                Height = 76,
                VerticalAlignment = VerticalAlignment.Center,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
                RenderTransformOrigin = new Point(0.5, 0.5)
            };

            var scale = new ScaleTransform(1, 1);
            root.RenderTransform = scale;
            var pulse = new DoubleAnimation
            {
                From = 1,
                To = 1.035,
                Duration = TimeSpan.FromSeconds(1.8),
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut }
            };
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, pulse);
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, pulse);

            var halo = new Ellipse
            {
                Width = 70,
                Height = 70,
                Fill = new RadialGradientBrush(Color.FromArgb(34, 37, 99, 235), Color.FromArgb(0, 37, 99, 235)),
                Stroke = new SolidColorBrush(Color.FromArgb(44, 37, 99, 235)),
                StrokeThickness = 1,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            root.Children.Add(halo);

            var mainRing = CreateRing(50, 5.0, Color.FromRgb(37, 99, 235), 0.94, new double[] { 116, 62 }, 7, false);
            root.Children.Add(mainRing);
            var innerRing = CreateRing(32, 3.0, Color.FromRgb(20, 184, 166), 0.78, new double[] { 68, 45 }, 5.5, true);
            root.Children.Add(innerRing);

            var core = new Ellipse
            {
                Width = 13,
                Height = 13,
                Fill = new SolidColorBrush(Color.FromRgb(15, 23, 42)),
                Stroke = new SolidColorBrush(Color.FromRgb(37, 99, 235)),
                StrokeThickness = 2,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center
            };
            root.Children.Add(core);

            return root;
        }

        private Ellipse CreateRing(double size, double strokeWidth, Color color, double opacity, double[] dash, double seconds, bool reverse)
        {
            var ring = new Ellipse
            {
                Width = size,
                Height = size,
                Fill = Brushes.Transparent,
                Stroke = new SolidColorBrush(color),
                StrokeThickness = strokeWidth,
                StrokeDashArray = new DoubleCollection(dash),
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                Opacity = opacity,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                VerticalAlignment = VerticalAlignment.Center,
                RenderTransformOrigin = new Point(0.5, 0.5)
            };
            var rotate = new RotateTransform(0);
            ring.RenderTransform = rotate;
            rotate.BeginAnimation(RotateTransform.AngleProperty, new DoubleAnimation
            {
                From = reverse ? 360 : 0,
                To = reverse ? 0 : 360,
                Duration = TimeSpan.FromSeconds(seconds),
                RepeatBehavior = RepeatBehavior.Forever
            });
            return ring;
        }

        private UIElement CreateProgressVisual()
        {
            var progressPanel = new StackPanel { Margin = new Thickness(4, 14, 4, 10) };
            var progressHeader = new Grid { Margin = new Thickness(0, 0, 0, 7) };
            progressHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            progressHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            status = new TextBlock { Text = "准备安装", FontSize = 12, FontWeight = FontWeights.Medium, Foreground = new SolidColorBrush(Color.FromRgb(71, 85, 105)) };
            progressPercent = new TextBlock { Text = "0%", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(37, 99, 235)) };
            Grid.SetColumn(progressPercent, 1);
            progressHeader.Children.Add(status);
            progressHeader.Children.Add(progressPercent);
            progressPanel.Children.Add(progressHeader);

            progressTrack = new Grid
            {
                Height = 6,
                ClipToBounds = true,
                Background = Brushes.Transparent
            };
            progressTrack.SizeChanged += (s, e) => UpdateProgressVisual(currentProgressValue);

            var bg = new Border
            {
                CornerRadius = new CornerRadius(3),
                Background = new SolidColorBrush(Color.FromRgb(235, 240, 247)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(221, 228, 238)),
                BorderThickness = new Thickness(1)
            };
            progressTrack.Children.Add(bg);

            progressFill = new Border
            {
                Width = 0,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(3),
                Background = new LinearGradientBrush(
                    Color.FromRgb(37, 99, 235),
                    Color.FromRgb(20, 184, 166),
                    new Point(0, 0.5),
                    new Point(1, 0.5))
            };
            progressTrack.Children.Add(progressFill);

            progressShine = new Border
            {
                Width = 72,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(3),
                Opacity = 0.22,
                Background = new LinearGradientBrush(
                    Color.FromArgb(0, 255, 255, 255),
                    Color.FromArgb(210, 255, 255, 255),
                    new Point(0, 0.5),
                    new Point(1, 0.5)),
                RenderTransform = new TranslateTransform(-80, 0)
            };
            progressTrack.Children.Add(progressShine);
            progressPanel.Children.Add(progressTrack);
            return progressPanel;
        }

        private void UpdateProgressVisual(double value)
        {
            currentProgressValue = Math.Max(0, Math.Min(100, value));
            if (webGlScene != null) webGlScene.SetState(currentProgressValue, currentProgressValue >= 100 ? "complete" : "install");
            if (progressPercent != null) progressPercent.Text = Math.Round(currentProgressValue).ToString("0") + "%";
            if (progressTrack == null || progressFill == null) return;
            var width = Math.Max(0, progressTrack.ActualWidth * currentProgressValue / 100.0);
            progressFill.BeginAnimation(FrameworkElement.WidthProperty, new DoubleAnimation
            {
                To = width,
                Duration = TimeSpan.FromMilliseconds(360),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            });
            if (progressShine != null && progressTrack.ActualWidth > 0 && currentProgressValue > 0 && currentProgressValue < 100)
            {
                var transform = progressShine.RenderTransform as TranslateTransform;
                if (transform != null)
                {
                    transform.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation
                    {
                        From = -80,
                        To = Math.Max(100, progressTrack.ActualWidth + 40),
                        Duration = TimeSpan.FromSeconds(1.6),
                        RepeatBehavior = RepeatBehavior.Forever
                    });
                }
            }
        }

        private UIElement PathRow(out TextBox box, string initial, Action browse)
        {
            var grid = new Grid { Margin = new Thickness(0, 5, 0, 0) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(104) });
            box = Ui.PathBox(initial);
            Grid.SetColumn(box, 0);
            grid.Children.Add(box);
            var btn = Ui.Button("浏览", new SolidColorBrush(Color.FromRgb(241, 245, 249)), new SolidColorBrush(Color.FromRgb(30, 41, 59)));
            btn.Height = 32;
            btn.Margin = new Thickness(10, 0, 0, 0);
            btn.Click += (s, e) => browse();
            Grid.SetColumn(btn, 1);
            grid.Children.Add(btn);
            return grid;
        }

        private void BrowseInstall()
        {
            var selected = Ui.PickFolder("选择软件安装位置", installPath.Text);
            if (!string.IsNullOrEmpty(selected)) installPath.Text = selected;
        }

        private void BrowseData()
        {
            var selected = Ui.PickFolder("选择数据存储位置", dataPath.Text);
            if (!string.IsNullOrEmpty(selected))
            {
                dataPathTouched = true;
                dataPath.Text = selected;
            }
        }

        private async Task InstallAsync()
        {
            var installDir = installPath.Text.Trim();
            var dataDir = dataPath.Text.Trim();
            if (string.IsNullOrWhiteSpace(installDir) || string.IsNullOrWhiteSpace(dataDir))
            {
                System.Windows.MessageBox.Show("请选择软件安装位置和数据存储位置。", InstallerConstants.AppName, MessageBoxButton.OK, MessageBoxImage.Warning);
                return;
            }

            var createDesktopShortcut = desktopShortcut.IsChecked == true;
            var createStartShortcut = startShortcut.IsChecked == true;
            var launchWhenDone = launchAfterInstall.IsChecked == true;
            installButton.IsEnabled = false;
            await Task.Run(() => InstallCore(installDir, dataDir, createDesktopShortcut, createStartShortcut, launchWhenDone));
        }

        private void SetStatus(string text, double value)
        {
            Dispatcher.Invoke(() => { status.Text = text; UpdateProgressVisual(value); });
        }

        private void InstallCore(string installDir, string dataDir, bool createDesktopShortcut, bool createStartShortcut, bool launchWhenDone)
        {
            try
            {
                SetStatus("正在安装中，请稍等", 8);
                Directory.CreateDirectory(installDir);
                Directory.CreateDirectory(dataDir);
                PathRules.WriteDataMarker(dataDir);

                SetStatus("正在安装中，请稍等", 18);
                ExtractZipResource("LingxiPayload.app.zip", installDir);

                SetStatus("正在安装中，请稍等", 72);
                File.WriteAllText(Path.Combine(installDir, InstallerConstants.DataPointerFile), dataDir, System.Text.Encoding.UTF8);

                SetStatus("正在安装中，请稍等", 78);
                ExtractBinaryResource("LingxiPayload.uninstaller.exe", Path.Combine(installDir, InstallerConstants.UninstallerExe));
                ExtractBinaryResource("LingxiPayload.webview2-core.dll", Path.Combine(installDir, "Microsoft.Web.WebView2.Core.dll"));
                ExtractBinaryResource("LingxiPayload.webview2-wpf.dll", Path.Combine(installDir, "Microsoft.Web.WebView2.Wpf.dll"));
                ExtractBinaryResource("LingxiPayload.webview2-loader.dll", Path.Combine(installDir, "WebView2Loader.dll"));

                SetStatus("正在安装中，请稍等", 84);
                var exePath = Path.Combine(installDir, InstallerConstants.AppExe);
                if (createDesktopShortcut)
                    Shortcut.Create(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), InstallerConstants.AppName + ".lnk", exePath, installDir);
                if (createStartShortcut)
                {
                    var startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", InstallerConstants.AppName);
                    Directory.CreateDirectory(startDir);
                    Shortcut.Create(startDir, InstallerConstants.AppName + ".lnk", exePath, installDir);
                }

                SetStatus("正在安装中，请稍等", 92);
                RegisterUninstall(installDir, dataDir);

                SetStatus("安装完成，窗口即将自动关闭", 100);
                Dispatcher.Invoke(() =>
                {
                    installButton.Content = "已完成";
                    installButton.IsEnabled = false;
                    if (launchWhenDone && File.Exists(exePath)) Process.Start(exePath);
                });
                System.Threading.Thread.Sleep(900);
                Dispatcher.Invoke(() => Close());
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    installButton.IsEnabled = true;
                    status.Text = "安装失败：" + ex.Message;
                    System.Windows.MessageBox.Show(ex.Message, "安装失败", MessageBoxButton.OK, MessageBoxImage.Error);
                });
            }
        }

        private void ExtractZipResource(string resourceName, string targetDir)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (stream == null) throw new InvalidOperationException("安装包资源缺失：" + resourceName);
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    foreach (var entry in archive.Entries)
                    {
                        var target = Path.GetFullPath(Path.Combine(targetDir, entry.FullName));
                        var root = Path.GetFullPath(targetDir).TrimEnd('\\') + "\\";
                        if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                        if (string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(target);
                            continue;
                        }
                        Directory.CreateDirectory(Path.GetDirectoryName(target));
                        entry.ExtractToFile(target, true);
                    }
                }
            }
        }

        private void ExtractBinaryResource(string resourceName, string target)
        {
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resourceName))
            {
                if (stream == null) throw new InvalidOperationException("安装包资源缺失：" + resourceName);
                using (var output = File.Create(target)) stream.CopyTo(output);
            }
        }

        private void RegisterUninstall(string installDir, string dataDir)
        {
            var uninstallerPath = "\"" + Path.Combine(installDir, InstallerConstants.UninstallerExe) + "\"";
            RegisterUninstallKey(Registry.CurrentUser.CreateSubKey(InstallerConstants.RegistryKey), installDir, dataDir, uninstallerPath);
            try
            {
                using (var localMachineKey = Registry.LocalMachine.CreateSubKey(InstallerConstants.RegistryKeyWow6432))
                {
                    RegisterUninstallKey(localMachineKey, installDir, dataDir, uninstallerPath);
                }
            }
            catch { }
        }

        private static void RegisterUninstallKey(RegistryKey key, string installDir, string dataDir, string uninstallerPath)
        {
            if (key == null) return;
            using (key)
            {
                key.SetValue("DisplayName", InstallerConstants.AppName);
                key.SetValue("DisplayVersion", InstallerConstants.AppVersion);
                key.SetValue("Publisher", "LingXiCode");
                key.SetValue("InstallLocation", installDir);
                key.SetValue("UninstallString", uninstallerPath);
                key.SetValue("QuietUninstallString", uninstallerPath + " --silent");
                key.SetValue("DisplayIcon", Path.Combine(installDir, InstallerConstants.AppExe));
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("LingxiDataDir", dataDir);
            }
        }
    }
#endif

#if UNINSTALLER
    public class UninstallWindow : Window
    {
        private string installDir;
        private string dataDir;
        private string apiDir;
        private CheckBox deleteData;
        private CheckBox deleteApi;
        private TextBlock status;
        private Button uninstallButton;
        private Grid uninstallProgressTrack;
        private Border uninstallProgressFill;
        private Border uninstallProgressShine;
        private TextBlock uninstallProgressPercent;
        private double uninstallProgressValue;
        private WebGlSceneHost uninstallWebGlScene;
        private bool silentMode;

        public UninstallWindow(bool silentMode = false)
        {
            this.silentMode = silentMode;
            installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            dataDir = ReadDataDir();
            apiDir = PathRules.UserApiConfigDir();
            Title = InstallerConstants.AppName + " 卸载";
            Width = 900;
            Height = 520;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ResizeMode = ResizeMode.NoResize;
            Background = new SolidColorBrush(Color.FromRgb(244, 247, 251));
            if (!silentMode)
            {
                Build();
            }
            else
            {
                // 静默模式：最小化窗口，不显示 UI
                WindowState = WindowState.Minimized;
                ShowInTaskbar = false;
                Visibility = Visibility.Hidden;
            }
        }

        /// <summary>
        /// 静默模式卸载入口，执行完成后调用方负责关闭应用
        /// </summary>
        public async Task ExecuteSilentUninstall()
        {
            await Task.Run(() =>
            {
                try
                {
                    // 1. 删除快捷方式
                    try { Shortcut.DeleteShortcuts(); } catch { }
                    // 2. 删除卸载注册表项
                    try { Registry.CurrentUser.DeleteSubKeyTree(InstallerConstants.RegistryKey, false); } catch { }
                    // 3. 保留用户数据（静默模式默认保留，与手动卸载不勾选一致）
                    try { PreserveDataBeforeRemovingInstallDir(); } catch { }
                    // 4. 调度删除安装目录（使用 helper 进程）
                    try { ScheduleInstallDirRemoval(); } catch { }
                }
                catch
                {
                    // 静默模式静默失败
                }
            });
        }

        private string ReadDataDir()
        {
            try
            {
                var pointer = Path.Combine(installDir, InstallerConstants.DataPointerFile);
                if (File.Exists(pointer)) return File.ReadAllText(pointer, System.Text.Encoding.UTF8).Trim();
            }
            catch { }
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(InstallerConstants.RegistryKey))
                {
                    var value = key == null ? "" : Convert.ToString(key.GetValue("LingxiDataDir", ""));
                    if (!string.IsNullOrWhiteSpace(value)) return value.Trim();
                }
            }
            catch { }
            try
            {
                var remembered = PathRules.ReadRememberedDataDir();
                if (!string.IsNullOrWhiteSpace(remembered)) return remembered;
            }
            catch { }
            return Path.Combine(installDir, "data");
        }

        private void Build()
        {
            var root = new Grid();
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(286) });
            root.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            var brand = CreateUninstallBrandPanel();
            Grid.SetColumn(brand, 0);
            root.Children.Add(brand);

            var content = new StackPanel { Margin = new Thickness(34, 28, 34, 22) };
            Grid.SetColumn(content, 1);
            content.Children.Add(Ui.Text("卸载 " + InstallerConstants.AppName, 25, new SolidColorBrush(Color.FromRgb(20, 30, 48)), FontWeights.Bold));
            content.Children.Add(new TextBlock { Text = "选择需要移除的内容", Margin = new Thickness(0, 7, 0, 20), FontSize = 13, Foreground = new SolidColorBrush(Color.FromRgb(88, 101, 125)) });

            var panel = new StackPanel();
            panel.Children.Add(new TextBlock { Text = "软件目录：" + installDir, FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 12) });
            deleteData = new CheckBox { Content = "同时删除项目数据、上下文、账本、缓存、记忆", IsChecked = false, FontSize = 13, Margin = new Thickness(0, 0, 0, 5) };
            panel.Children.Add(deleteData);
            panel.Children.Add(new TextBlock { Text = dataDir, FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(22, 0, 0, 10) });
            deleteApi = new CheckBox { Content = "同时删除模型 API 配置（.lingxicode）", IsChecked = false, FontSize = 13, Margin = new Thickness(0, 0, 0, 5) };
            panel.Children.Add(deleteApi);
            panel.Children.Add(new TextBlock { Text = apiDir, FontSize = 12, Foreground = new SolidColorBrush(Color.FromRgb(100, 116, 139)), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(22, 0, 0, 0) });
            content.Children.Add(Ui.Card(panel));

            content.Children.Add(CreateUninstallProgressVisual());

            var actions = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, HorizontalAlignment = System.Windows.HorizontalAlignment.Right };
            var cancel = Ui.Button("取消", new SolidColorBrush(Color.FromRgb(226, 232, 240)), new SolidColorBrush(Color.FromRgb(30, 41, 59)));
            cancel.Click += (s, e) => Close();
            uninstallButton = Ui.Button("开始卸载", new SolidColorBrush(Color.FromRgb(220, 38, 38)), Brushes.White);
            uninstallButton.Margin = new Thickness(12, 0, 0, 0);
            uninstallButton.Click += async (s, e) => await UninstallAsync();
            actions.Children.Add(cancel);
            actions.Children.Add(uninstallButton);
            content.Children.Add(actions);

            root.Children.Add(content);
            Content = root;
        }

        private Border CreateUninstallBrandPanel()
        {
            var panel = new Grid { Margin = new Thickness(32, 34, 30, 30) };
            panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            panel.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
            panel.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            var heading = new StackPanel();
            heading.Children.Add(new TextBlock { Text = "安全卸载", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(125, 211, 252)) });
            heading.Children.Add(Ui.Text(InstallerConstants.AppName, 25, Brushes.White, FontWeights.Bold));
            heading.Children.Add(new TextBlock { Text = "清理软件，保留你的工作", Margin = new Thickness(0, 6, 0, 0), FontSize = 13, Foreground = new SolidColorBrush(Color.FromRgb(186, 201, 224)) });
            panel.Children.Add(heading);
            var center = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
            uninstallWebGlScene = new WebGlSceneHost(196, 142);
            center.Children.Add(uninstallWebGlScene.View);
            center.Children.Add(new TextBlock { Text = "默认保护", FontSize = 12, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(147, 197, 253)), HorizontalAlignment = System.Windows.HorizontalAlignment.Center });
            center.Children.Add(Ui.Text("项目数据", 24, Brushes.White, FontWeights.Bold));
            center.Children.Add(new TextBlock { Text = "只有主动勾选，数据与模型 API 配置才会被删除。", Width = 196, Margin = new Thickness(0, 12, 0, 0), FontSize = 12, LineHeight = 19, Foreground = new SolidColorBrush(Color.FromRgb(174, 190, 214)), TextAlignment = TextAlignment.Center, TextWrapping = TextWrapping.Wrap });
            Grid.SetRow(center, 1);
            panel.Children.Add(center);
            var footer = new StackPanel();
            footer.Children.Add(new Border { Height = 1, Margin = new Thickness(0, 0, 0, 15), Background = new SolidColorBrush(Color.FromArgb(38, 255, 255, 255)) });
            footer.Children.Add(new TextBlock { Text = "卸载完成后会显示处理结果，已保留的数据可在重新安装后继续使用。", FontSize = 12, LineHeight = 19, Foreground = new SolidColorBrush(Color.FromRgb(174, 190, 214)), TextWrapping = TextWrapping.Wrap });
            Grid.SetRow(footer, 2);
            panel.Children.Add(footer);
            return new Border { Background = new LinearGradientBrush(Color.FromRgb(13, 28, 51), Color.FromRgb(20, 45, 74), new Point(0, 0), new Point(1, 1)), Child = panel };
        }


        private UIElement CreateUninstallProgressVisual()
        {
            var progressPanel = new StackPanel { Margin = new Thickness(4, 16, 4, 14) };
            var progressHeader = new Grid { Margin = new Thickness(0, 0, 0, 7) };
            progressHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            progressHeader.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            status = new TextBlock { Text = "准备卸载", FontSize = 12, FontWeight = FontWeights.Medium, Foreground = new SolidColorBrush(Color.FromRgb(71, 85, 105)) };
            uninstallProgressPercent = new TextBlock { Text = "0%", FontSize = 11, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(37, 99, 235)) };
            Grid.SetColumn(uninstallProgressPercent, 1);
            progressHeader.Children.Add(status);
            progressHeader.Children.Add(uninstallProgressPercent);
            progressPanel.Children.Add(progressHeader);

            uninstallProgressTrack = new Grid
            {
                Height = 6,
                ClipToBounds = true,
                Background = Brushes.Transparent
            };
            uninstallProgressTrack.SizeChanged += (s, e) => UpdateUninstallProgressVisual(uninstallProgressValue);
            uninstallProgressTrack.Children.Add(new Border
            {
                CornerRadius = new CornerRadius(3),
                Background = new SolidColorBrush(Color.FromRgb(235, 240, 247)),
                BorderBrush = new SolidColorBrush(Color.FromRgb(221, 228, 238)),
                BorderThickness = new Thickness(1)
            });
            uninstallProgressFill = new Border
            {
                Width = 0,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(3),
                Background = new LinearGradientBrush(Color.FromRgb(37, 99, 235), Color.FromRgb(20, 184, 166), new Point(0, 0.5), new Point(1, 0.5))
            };
            uninstallProgressTrack.Children.Add(uninstallProgressFill);
            uninstallProgressShine = new Border
            {
                Width = 72,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Left,
                CornerRadius = new CornerRadius(3),
                Opacity = 0.22,
                Background = new LinearGradientBrush(Color.FromArgb(0, 255, 255, 255), Color.FromArgb(210, 255, 255, 255), new Point(0, 0.5), new Point(1, 0.5)),
                RenderTransform = new TranslateTransform(-80, 0)
            };
            uninstallProgressTrack.Children.Add(uninstallProgressShine);
            progressPanel.Children.Add(uninstallProgressTrack);
            return progressPanel;
        }

        private void UpdateUninstallProgressVisual(double value)
        {
            uninstallProgressValue = Math.Max(0, Math.Min(100, value));
            if (uninstallWebGlScene != null) uninstallWebGlScene.SetState(uninstallProgressValue, uninstallProgressValue >= 100 ? "complete" : "uninstall");
            if (uninstallProgressPercent != null) uninstallProgressPercent.Text = Math.Round(uninstallProgressValue).ToString("0") + "%";
            if (uninstallProgressTrack == null || uninstallProgressFill == null) return;
            var width = Math.Max(0, uninstallProgressTrack.ActualWidth * uninstallProgressValue / 100.0);
            uninstallProgressFill.BeginAnimation(FrameworkElement.WidthProperty, new DoubleAnimation
            {
                To = width,
                Duration = TimeSpan.FromMilliseconds(300),
                EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
            });
            if (uninstallProgressShine != null && uninstallProgressTrack.ActualWidth > 0 && uninstallProgressValue > 0 && uninstallProgressValue < 100)
            {
                var transform = uninstallProgressShine.RenderTransform as TranslateTransform;
                if (transform != null)
                {
                    transform.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation
                    {
                        From = -80,
                        To = Math.Max(100, uninstallProgressTrack.ActualWidth + 40),
                        Duration = TimeSpan.FromSeconds(1.6),
                        RepeatBehavior = RepeatBehavior.Forever
                    });
                }
            }
        }

        private async Task UninstallAsync()
        {
            var removeData = deleteData.IsChecked == true;
            var removeApi = deleteApi.IsChecked == true;
            uninstallButton.IsEnabled = false;
            await Task.Run(() => UninstallCore(removeData, removeApi));
        }

        private void SetStatus(string text, double value)
        {
            Dispatcher.Invoke(() => { status.Text = text; UpdateUninstallProgressVisual(value); });
        }

        private void UninstallCore(bool removeData, bool removeApi)
        {
            try
            {
                SetStatus("正在卸载中，请稍等", 12);
                Shortcut.DeleteShortcuts();
                Registry.CurrentUser.DeleteSubKeyTree(InstallerConstants.RegistryKey, false);

                if (removeData && Directory.Exists(dataDir) && PathRules.IsSafeDeleteTarget(dataDir))
                {
                    SetStatus("正在卸载中，请稍等", 46);
                    Directory.Delete(dataDir, true);
                    PathRules.DeleteDataMarker();
                }
                else if (!removeData)
                {
                    SetStatus("正在保留用户数据", 46);
                    PreserveDataBeforeRemovingInstallDir();
                }
                if (removeApi && Directory.Exists(apiDir) && PathRules.IsSafeDeleteTarget(apiDir))
                {
                    SetStatus("正在卸载中，请稍等", 66);
                    Directory.Delete(apiDir, true);
                }

                SetStatus("正在卸载中，请稍等", 90);
                ScheduleInstallDirRemoval();
                SetStatus("卸载完成", 100);
                System.Threading.Thread.Sleep(350);
                Dispatcher.Invoke(() =>
                {
                    if (!silentMode)
                    {
                        System.Windows.MessageBox.Show("灵犀 LingXiCode 已成功卸载。", "卸载完成", MessageBoxButton.OK, MessageBoxImage.Information);
                    }
                    Close();
                });
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    uninstallButton.IsEnabled = true;
                    status.Text = "卸载失败：" + ex.Message;
                    System.Windows.MessageBox.Show(ex.Message, "卸载失败", MessageBoxButton.OK, MessageBoxImage.Error);
                });
            }
        }

        private void ScheduleInstallDirRemoval()
        {
            if (string.IsNullOrWhiteSpace(installDir) || !PathRules.IsSafeInstallDirDeleteTarget(installDir))
            {
                throw new InvalidOperationException("安装目录不安全，已停止卸载清理。");
            }

            var currentExe = Process.GetCurrentProcess().MainModule.FileName;
            var helperDir = Path.Combine(Path.GetTempPath(), "lingxi-uninstall-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(helperDir);
            var helperExe = Path.Combine(helperDir, InstallerConstants.UninstallerExe);
            File.Copy(currentExe, helperExe, true);

            var args = "--cleanup-install-dir \"" + installDir.Replace("\"", "") + "\" " + Process.GetCurrentProcess().Id;
            Process.Start(new ProcessStartInfo(helperExe, args)
            {
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = helperDir
            });
        }

        private void PreserveDataBeforeRemovingInstallDir()
        {
            if (string.IsNullOrWhiteSpace(dataDir)) return;

            var preservedDataDir = dataDir;
            if (Directory.Exists(dataDir) && PathRules.IsInsideDirectory(installDir, dataDir))
            {
                preservedDataDir = PathRules.DefaultDataDir("");
                if (!string.Equals(Path.GetFullPath(dataDir).TrimEnd('\\'), Path.GetFullPath(preservedDataDir).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                {
                    CopyDirectory(dataDir, preservedDataDir);
                }
            }

            PathRules.WriteDataMarker(preservedDataDir);
        }

        private void CopyDirectory(string sourceDir, string targetDir)
        {
            Directory.CreateDirectory(targetDir);
            foreach (var directory in Directory.GetDirectories(sourceDir, "*", SearchOption.AllDirectories))
            {
                var relative = directory.Substring(sourceDir.Length).TrimStart('\\');
                Directory.CreateDirectory(Path.Combine(targetDir, relative));
            }
            foreach (var file in Directory.GetFiles(sourceDir, "*", SearchOption.AllDirectories))
            {
                var relative = file.Substring(sourceDir.Length).TrimStart('\\');
                var target = Path.Combine(targetDir, relative);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                File.Copy(file, target, true);
            }
        }
    }
#endif

    public static class Shortcut
    {
        public static void Create(string folder, string name, string target, string workingDir)
        {
            Directory.CreateDirectory(folder);
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            dynamic shortcut = shell.CreateShortcut(Path.Combine(folder, name));
            shortcut.TargetPath = target;
            shortcut.WorkingDirectory = workingDir;
            shortcut.IconLocation = target;
            shortcut.Save();
        }

        public static void DeleteShortcuts()
        {
            TryDelete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), InstallerConstants.AppName + ".lnk"));
            var startDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", InstallerConstants.AppName);
            TryDelete(Path.Combine(startDir, InstallerConstants.AppName + ".lnk"));
            try { if (Directory.Exists(startDir) && !Directory.EnumerateFileSystemEntries(startDir).Any()) Directory.Delete(startDir); } catch { }
        }

        private static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }
}
