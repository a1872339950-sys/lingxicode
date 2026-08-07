param(
  [Parameter(Mandatory = $true)][string]$Action,
  [string]$PayloadBase64 = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public class LingxiNativeWindowInfo {
  public long Handle { get; set; }
  public int ProcessId { get; set; }
  public string Title { get; set; }
}

public static class LingxiNativeWindows {
  private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr hWnd, ref POINT pt);
  [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr hWnd, uint command);
  [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
  [DllImport("user32.dll")] private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [DllImport("user32.dll")] private static extern short VkKeyScan(char ch);
  [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint uCode, uint uMapType);

  [StructLayout(LayoutKind.Sequential)]
  private struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  private struct INPUT {
    public uint type;
    public InputUnion U;
  }

  [StructLayout(LayoutKind.Explicit)]
  private struct InputUnion {
    [FieldOffset(0)] public MOUSEINPUT mi;
    [FieldOffset(0)] public KEYBDINPUT ki;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct MOUSEINPUT {
    public int dx;
    public int dy;
    public uint mouseData;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct KEYBDINPUT {
    public ushort wVk;
    public ushort wScan;
    public uint dwFlags;
    public uint time;
    public IntPtr dwExtraInfo;
  }

  private const uint INPUT_MOUSE = 0;
  private const uint INPUT_KEYBOARD = 1;
  private const uint MOUSEEVENTF_MOVE = 0x0001;
  private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  private const uint MOUSEEVENTF_LEFTUP = 0x0004;
  private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
  private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
  private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
  private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
  private const uint MOUSEEVENTF_WHEEL = 0x0800;
  private const uint MOUSEEVENTF_HWHEEL = 0x1000;
  private const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
  private const uint KEYEVENTF_KEYUP = 0x0002;
  private const uint KEYEVENTF_UNICODE = 0x0004;
  private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;

  public static LingxiNativeWindowInfo[] List() {
    var result = new List<LingxiNativeWindowInfo>();
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      var length = GetWindowTextLength(hWnd);
      if (length <= 0) return true;
      var title = new StringBuilder(length + 1);
      GetWindowText(hWnd, title, title.Capacity);
      uint pid;
      GetWindowThreadProcessId(hWnd, out pid);
      result.Add(new LingxiNativeWindowInfo { Handle = hWnd.ToInt64(), ProcessId = (int)pid, Title = title.ToString() });
      return true;
    }, IntPtr.Zero);
    return result.ToArray();
  }

  public static bool GetBounds(long handle, out int left, out int top, out int width, out int height) {
    left = top = width = height = 0;
    RECT rect;
    if (!GetWindowRect(new IntPtr(handle), out rect)) return false;
    left = rect.Left;
    top = rect.Top;
    width = Math.Max(1, rect.Right - rect.Left);
    height = Math.Max(1, rect.Bottom - rect.Top);
    return true;
  }

  public static bool WindowToScreen(long handle, int windowX, int windowY, out int screenX, out int screenY) {
    screenX = screenY = 0;
    int left, top, width, height;
    if (!GetBounds(handle, out left, out top, out width, out height)) return false;
    screenX = left + windowX;
    screenY = top + windowY;
    return true;
  }

  public static string CapturePngBase64(long handle) {
    var hWnd = new IntPtr(handle);
    RECT rect;
    if (!GetWindowRect(hWnd, out rect)) throw new InvalidOperationException("GetWindowRect failed");
    var width = Math.Max(1, rect.Right - rect.Left);
    var height = Math.Max(1, rect.Bottom - rect.Top);

    // Prefer PrintWindow (works for occluded windows in many cases).
    try {
      using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
      using (var graphics = Graphics.FromImage(bitmap)) {
        var hdc = graphics.GetHdc();
        try {
          if (PrintWindow(hWnd, hdc, 2)) {
            graphics.ReleaseHdc(hdc);
            hdc = IntPtr.Zero;
            if (!IsMostlyBlack(bitmap)) {
              return BitmapToPngBase64(bitmap);
            }
          }
        } finally {
          if (hdc != IntPtr.Zero) graphics.ReleaseHdc(hdc);
        }
      }
    } catch { }

    // Fallback: screen blit (requires visible region; better for some DirectX UIs).
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
    using (var graphics = Graphics.FromImage(bitmap)) {
      graphics.CopyFromScreen(rect.Left, rect.Top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
      return BitmapToPngBase64(bitmap);
    }
  }

  private static bool IsMostlyBlack(Bitmap bitmap) {
    int sample = 0;
    int dark = 0;
    int stepX = Math.Max(1, bitmap.Width / 24);
    int stepY = Math.Max(1, bitmap.Height / 24);
    for (int y = 0; y < bitmap.Height; y += stepY) {
      for (int x = 0; x < bitmap.Width; x += stepX) {
        var c = bitmap.GetPixel(x, y);
        sample++;
        if (c.R < 12 && c.G < 12 && c.B < 12) dark++;
      }
    }
    return sample > 0 && dark * 100 / sample > 92;
  }

  private static string BitmapToPngBase64(Bitmap bitmap) {
    using (var stream = new MemoryStream()) {
      bitmap.Save(stream, ImageFormat.Png);
      return Convert.ToBase64String(stream.ToArray());
    }
  }

  private static IntPtr RootWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return IntPtr.Zero;
    var root = GetAncestor(hWnd, 2);
    return root == IntPtr.Zero ? hWnd : root;
  }

  private static bool IsTargetForeground(IntPtr hWnd) {
    return RootWindow(GetForegroundWindow()) == RootWindow(hWnd);
  }

  private static void RequireForeground(long handle) {
    if (!Activate(handle)) {
      throw new InvalidOperationException("Target window could not be brought to the foreground; input was cancelled to avoid controlling another window");
    }
  }

  private static IntPtr TopInputWindowAtScreenPoint(int screenX, int screenY) {
    var current = GetTopWindow(IntPtr.Zero);
    int guard = 0;
    while (current != IntPtr.Zero && guard++ < 4096) {
      RECT rect;
      if (IsWindowVisible(current) && GetWindowRect(current, out rect)
          && screenX >= rect.Left && screenX < rect.Right
          && screenY >= rect.Top && screenY < rect.Bottom) {
        int exStyle = GetWindowLong(current, -20);
        bool inputTransparent = (exStyle & 0x20) != 0;
        if (!inputTransparent) return RootWindow(current);
      }
      current = GetWindow(current, 2);
    }
    return RootWindow(WindowFromPoint(new POINT { X = screenX, Y = screenY }));
  }

  private static bool IsTargetAtScreenPoint(long handle, int screenX, int screenY) {
    var targetRoot = RootWindow(new IntPtr(handle));
    return targetRoot != IntPtr.Zero && TopInputWindowAtScreenPoint(screenX, screenY) == targetRoot;
  }

  private static void RequireTargetAtScreenPoint(long handle, int screenX, int screenY) {
    if (IsTargetAtScreenPoint(handle, screenX, screenY)) return;
    var targetRoot = RootWindow(new IntPtr(handle));
    var hitRoot = TopInputWindowAtScreenPoint(screenX, screenY);
    throw new InvalidOperationException(
      "Target point is covered by another input window; input was cancelled"
      + " (target=" + targetRoot.ToInt64() + ", blocker=" + hitRoot.ToInt64() + ")"
    );
  }

  private static bool PreparePointerInput(long handle, int screenX, int screenY) {
    RequireForeground(handle);
    if (IsTargetAtScreenPoint(handle, screenX, screenY)) return false;

    var hWnd = RootWindow(new IntPtr(handle));
    bool wasTopmost = (GetWindowLong(hWnd, -20) & 0x8) != 0;
    if (!wasTopmost && !SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0003)) {
      throw new InvalidOperationException("Target window could not be raised above the covering window; input was cancelled");
    }
    BringWindowToTop(hWnd);
    SetForegroundWindow(hWnd);
    for (int attempt = 0; attempt < 30; attempt++) {
      if (IsTargetForeground(hWnd) && IsTargetAtScreenPoint(handle, screenX, screenY)) {
        return !wasTopmost;
      }
      Thread.Sleep(50);
    }
    if (!wasTopmost) SetWindowPos(hWnd, new IntPtr(-2), 0, 0, 0, 0, 0x0003);
    RequireTargetAtScreenPoint(handle, screenX, screenY);
    throw new InvalidOperationException("Target window did not become ready for pointer input");
  }

  private static void RestorePointerInput(long handle, bool promotedToTopmost) {
    if (!promotedToTopmost) return;
    var hWnd = RootWindow(new IntPtr(handle));
    SetWindowPos(hWnd, new IntPtr(-2), 0, 0, 0, 0, 0x0003);
  }

  public static bool Activate(long handle) {
    var hWnd = new IntPtr(handle);
    if (!IsWindow(hWnd)) return false;
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9);
    else ShowWindow(hWnd, 5);

    var foreground = GetForegroundWindow();
    uint targetThread = GetWindowThreadProcessId(hWnd, IntPtr.Zero);
    uint foreThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint curThread = GetCurrentThreadId();
    bool attachedFore = false;
    bool attachedCur = false;
    try {
      if (foreThread != curThread) {
        attachedFore = AttachThreadInput(curThread, foreThread, true);
      }
      if (targetThread != curThread && targetThread != foreThread) {
        attachedCur = AttachThreadInput(curThread, targetThread, true);
      }
      BringWindowToTop(hWnd);
      SetForegroundWindow(hWnd);
    } finally {
      if (attachedCur) AttachThreadInput(curThread, targetThread, false);
      if (attachedFore) AttachThreadInput(curThread, foreThread, false);
    }

    for (int attempt = 0; attempt < 50; attempt++) {
      if (IsTargetForeground(hWnd)) return true;
      if (attempt == 10 || attempt == 25) {
        BringWindowToTop(hWnd);
        SetForegroundWindow(hWnd);
      }
      Thread.Sleep(50);
    }
    return IsTargetForeground(hWnd);
  }

  public static bool WindowExists(long handle) {
    return IsWindow(new IntPtr(handle));
  }

  public static bool IsMinimized(long handle) {
    var hWnd = RootWindow(new IntPtr(handle));
    return hWnd != IntPtr.Zero && IsWindow(hWnd) && IsIconic(hWnd);
  }

  private static void SendMouseAbsolute(int screenX, int screenY, uint flags, uint data = 0) {
    int screenW = Math.Max(1, GetSystemMetrics(0));
    int screenH = Math.Max(1, GetSystemMetrics(1));
    int absX = (int)Math.Round(screenX * 65535.0 / Math.Max(1, screenW - 1));
    int absY = (int)Math.Round(screenY * 65535.0 / Math.Max(1, screenH - 1));
    var input = new INPUT {
      type = INPUT_MOUSE,
      U = new InputUnion {
        mi = new MOUSEINPUT {
          dx = absX,
          dy = absY,
          mouseData = data,
          dwFlags = flags | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_MOVE,
          time = 0,
          dwExtraInfo = IntPtr.Zero
        }
      }
    };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 0) {
      throw new InvalidOperationException("SendInput mouse failed");
    }
  }

  private static void SendMouseFlag(uint flags, uint data = 0) {
    var input = new INPUT {
      type = INPUT_MOUSE,
      U = new InputUnion {
        mi = new MOUSEINPUT {
          dx = 0,
          dy = 0,
          mouseData = data,
          dwFlags = flags,
          time = 0,
          dwExtraInfo = IntPtr.Zero
        }
      }
    };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 0) {
      throw new InvalidOperationException("SendInput mouse flag failed");
    }
  }

  public static void ClickAtWindow(long handle, int windowX, int windowY, string button, int clickCount) {
    RequireForeground(handle);
    int sx, sy;
    if (!WindowToScreen(handle, windowX, windowY, out sx, out sy)) {
      throw new InvalidOperationException("Failed to map window coordinates");
    }
    bool promoted = PreparePointerInput(handle, sx, sy);
    try {
      string b = (button ?? "left").ToLowerInvariant();
      uint down = MOUSEEVENTF_LEFTDOWN;
      uint up = MOUSEEVENTF_LEFTUP;
      if (b == "right" || b == "r") { down = MOUSEEVENTF_RIGHTDOWN; up = MOUSEEVENTF_RIGHTUP; }
      else if (b == "middle" || b == "m") { down = MOUSEEVENTF_MIDDLEDOWN; up = MOUSEEVENTF_MIDDLEUP; }
      int count = Math.Max(1, Math.Min(clickCount, 5));
      SendMouseAbsolute(sx, sy, 0);
      Thread.Sleep(30);
      RequireTargetAtScreenPoint(handle, sx, sy);
      for (int i = 0; i < count; i++) {
        SendMouseFlag(down);
        Thread.Sleep(20);
        SendMouseFlag(up);
        Thread.Sleep(40);
      }
    } finally {
      RestorePointerInput(handle, promoted);
    }
  }

  public static void DragWindow(long handle, int fromX, int fromY, int toX, int toY) {
    RequireForeground(handle);
    int sx1, sy1, sx2, sy2;
    if (!WindowToScreen(handle, fromX, fromY, out sx1, out sy1)) throw new InvalidOperationException("from mapping failed");
    if (!WindowToScreen(handle, toX, toY, out sx2, out sy2)) throw new InvalidOperationException("to mapping failed");
    bool promoted = PreparePointerInput(handle, sx1, sy1);
    bool mouseDown = false;
    try {
      SendMouseAbsolute(sx1, sy1, 0);
      Thread.Sleep(30);
      RequireTargetAtScreenPoint(handle, sx1, sy1);
      SendMouseFlag(MOUSEEVENTF_LEFTDOWN);
      mouseDown = true;
      Thread.Sleep(30);
      int steps = 12;
      for (int i = 1; i <= steps; i++) {
        int x = sx1 + (sx2 - sx1) * i / steps;
        int y = sy1 + (sy2 - sy1) * i / steps;
        SendMouseAbsolute(x, y, 0);
        Thread.Sleep(12);
      }
      SendMouseFlag(MOUSEEVENTF_LEFTUP);
      mouseDown = false;
    } finally {
      if (mouseDown) {
        try { SendMouseFlag(MOUSEEVENTF_LEFTUP); } catch { }
      }
      RestorePointerInput(handle, promoted);
    }
  }

  public static void ScrollWindow(long handle, int windowX, int windowY, int scrollX, int scrollY) {
    RequireForeground(handle);
    int sx, sy;
    if (!WindowToScreen(handle, windowX, windowY, out sx, out sy)) throw new InvalidOperationException("scroll mapping failed");
    bool promoted = PreparePointerInput(handle, sx, sy);
    try {
      SendMouseAbsolute(sx, sy, 0);
      Thread.Sleep(30);
      RequireTargetAtScreenPoint(handle, sx, sy);
      // Windows wheel: +120 per notch up; our API: positive scrollY = down (Codex-like)
      if (scrollY != 0) {
        int notches = Math.Max(1, Math.Min(30, Math.Abs(scrollY) / 40 + (Math.Abs(scrollY) % 40 == 0 ? 0 : 1)));
        int signed = (scrollY > 0 ? -120 : 120) * notches;
        SendMouseFlag(MOUSEEVENTF_WHEEL, unchecked((uint)signed));
      }
      if (scrollX != 0) {
        int notches = Math.Max(1, Math.Min(30, Math.Abs(scrollX) / 40 + (Math.Abs(scrollX) % 40 == 0 ? 0 : 1)));
        int signed = (scrollX > 0 ? 120 : -120) * notches;
        SendMouseFlag(MOUSEEVENTF_HWHEEL, unchecked((uint)signed));
      }
    } finally {
      RestorePointerInput(handle, promoted);
    }
  }

  private static void SendKeyVk(ushort vk, bool keyUp, bool extended = false) {
    uint flags = keyUp ? KEYEVENTF_KEYUP : 0;
    if (extended) flags |= KEYEVENTF_EXTENDEDKEY;
    var input = new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT {
          wVk = vk,
          wScan = (ushort)MapVirtualKey(vk, 0),
          dwFlags = flags,
          time = 0,
          dwExtraInfo = IntPtr.Zero
        }
      }
    };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 0) {
      throw new InvalidOperationException("SendInput key failed");
    }
  }

  private static void SendUnicodeChar(char ch, bool keyUp) {
    var input = new INPUT {
      type = INPUT_KEYBOARD,
      U = new InputUnion {
        ki = new KEYBDINPUT {
          wVk = 0,
          wScan = ch,
          dwFlags = KEYEVENTF_UNICODE | (keyUp ? KEYEVENTF_KEYUP : 0u),
          time = 0,
          dwExtraInfo = IntPtr.Zero
        }
      }
    };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) == 0) {
      throw new InvalidOperationException("SendInput unicode failed");
    }
  }

  public static void TypeText(long handle, string text) {
    if (text == null) text = "";
    RequireForeground(handle);
    foreach (char ch in text) {
      if (ch == '\r') continue;
      if (ch == '\n') {
        SendKeyVk(0x0D, false); // VK_RETURN
        SendKeyVk(0x0D, true);
        Thread.Sleep(8);
        continue;
      }
      if (ch == '\t') {
        SendKeyVk(0x09, false);
        SendKeyVk(0x09, true);
        Thread.Sleep(8);
        continue;
      }
      SendUnicodeChar(ch, false);
      SendUnicodeChar(ch, true);
      Thread.Sleep(4);
    }
  }

  public static ushort ResolveVk(string token) {
    if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("empty key token");
    string t = token.Trim();
    string lower = t.ToLowerInvariant();

    // Modifiers / aliases
    if (lower == "control" || lower == "ctrl" || lower == "control_l" || lower == "control_r") return 0x11;
    if (lower == "shift" || lower == "shift_l" || lower == "shift_r") return 0x10;
    if (lower == "alt" || lower == "alt_l" || lower == "alt_r" || lower == "menu") return 0x12;
    // Block Windows/Meta keys for safety (guidance forbids Win-key automation)
    if (lower == "meta" || lower == "super" || lower == "win" || lower == "windows" || lower == "cmd" || lower == "command" || lower == "os") {
      throw new InvalidOperationException("Windows/Meta key injection is blocked for safety");
    }

    if (lower == "return" || lower == "enter" || lower == "kp_enter" || lower == "numpad_enter") return 0x0D;
    if (lower == "tab") return 0x09;
    if (lower == "escape" || lower == "esc") return 0x1B;
    if (lower == "space" || lower == "spacebar") return 0x20;
    if (lower == "backspace" || lower == "back") return 0x08;
    if (lower == "delete" || lower == "del") return 0x2E;
    if (lower == "insert" || lower == "ins") return 0x2D;
    if (lower == "home") return 0x24;
    if (lower == "end") return 0x23;
    if (lower == "page_up" || lower == "pageup" || lower == "prior") return 0x21;
    if (lower == "page_down" || lower == "pagedown" || lower == "next") return 0x22;
    if (lower == "left" || lower == "arrow_left") return 0x25;
    if (lower == "up" || lower == "arrow_up") return 0x26;
    if (lower == "right" || lower == "arrow_right") return 0x27;
    if (lower == "down" || lower == "arrow_down") return 0x28;
    if (lower == "capslock" || lower == "caps_lock") return 0x14;
    if (lower == "print" || lower == "printscreen" || lower == "snapshot") return 0x2C;
    if (lower == "period" || lower == "greater" || lower == ".") return 0xBE;
    if (lower == "comma" || lower == "less" || lower == ",") return 0xBC;
    if (lower == "slash" || lower == "question" || lower == "/") return 0xBF;
    if (lower == "semicolon" || lower == ";") return 0xBA;
    if (lower == "quote" || lower == "'") return 0xDE;
    if (lower == "bracketleft" || lower == "[") return 0xDB;
    if (lower == "bracketright" || lower == "]") return 0xDD;
    if (lower == "backslash" || lower == "\\") return 0xDC;
    if (lower == "minus" || lower == "underscore" || lower == "-") return 0xBD;
    if (lower == "equal" || lower == "plus" || lower == "=") return 0xBB;
    if (lower == "grave" || lower == "`") return 0xC0;

    // Function keys (C# 5 compatible: no out-var)
    int fn;
    if (lower.Length >= 2 && lower[0] == 'f' && int.TryParse(lower.Substring(1), out fn) && fn >= 1 && fn <= 24) {
      return (ushort)(0x70 + fn - 1);
    }

    // Numpad
    if (lower.StartsWith("kp_") || lower.StartsWith("numpad_")) {
      string n = lower.StartsWith("kp_") ? lower.Substring(3) : lower.Substring(7);
      if (n == "add" || n == "plus") return 0x6B;
      if (n == "subtract" || n == "minus") return 0x6D;
      if (n == "multiply") return 0x6A;
      if (n == "divide") return 0x6F;
      if (n == "decimal") return 0x6E;
      if (n.Length == 1 && n[0] >= '0' && n[0] <= '9') return (ushort)(0x60 + (n[0] - '0'));
    }

    // Single printable character
    if (t.Length == 1) {
      char ch = t[0];
      if (ch >= 'a' && ch <= 'z') return (ushort)(ch - 'a' + 0x41);
      if (ch >= 'A' && ch <= 'Z') return (ushort)ch;
      if (ch >= '0' && ch <= '9') return (ushort)ch;
      short scanned = VkKeyScan(ch);
      if (scanned != -1) return (ushort)(scanned & 0xFF);
    }

    throw new ArgumentException("Unsupported key: " + token);
  }

  public static bool IsExtendedVk(ushort vk) {
    // arrows, insert/delete/home/end/page, numpad divide/enter etc.
    return vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24
      || vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28
      || vk == 0x2D || vk == 0x2E || vk == 0x6F;
  }

  public static void PressKeyChord(long handle, string chord) {
    if (string.IsNullOrWhiteSpace(chord)) throw new ArgumentException("key is required");
    RequireForeground(handle);
    var parts = chord.Split(new[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
    var vks = new List<ushort>();
    foreach (var part in parts) {
      vks.Add(ResolveVk(part.Trim()));
    }
    if (vks.Count == 0) throw new ArgumentException("key is required");
    foreach (var vk in vks) SendKeyVk(vk, false, IsExtendedVk(vk));
    Thread.Sleep(20);
    for (int i = vks.Count - 1; i >= 0; i--) SendKeyVk(vks[i], true, IsExtendedVk(vks[i]));
  }
}
"@ -ReferencedAssemblies System.Drawing,System.Windows.Forms

function Read-Payload {
  if (-not $PayloadBase64) { return [pscustomobject]@{} }
  $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
  return $json | ConvertFrom-Json
}

function Get-SafeInt($Value, [int]$Default = 0) {
  if ($null -eq $Value) { return $Default }
  if ($Value -is [System.Array]) {
    if ($Value.Length -le 0) { return $Default }
    $Value = $Value[0]
  }
  try { return [int]$Value } catch { return $Default }
}

function Get-SafeLong($Value, [long]$Default = 0) {
  if ($null -eq $Value) { return $Default }
  if ($Value -is [System.Array]) {
    if ($Value.Length -le 0) { return $Default }
    $Value = $Value[0]
  }
  try { return [long]$Value } catch { return $Default }
}

function Get-ProcessTable {
  return @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, ExecutablePath, Name)
}

function Get-DescendantProcessIds([int]$RootPid, $Processes) {
  $ids = New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$ids.Add($RootPid)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $Processes) {
      if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) {
        [void]$ids.Add([int]$process.ProcessId)
        $changed = $true
      }
    }
  }
  return $ids
}

function Get-ElementRole($Element) {
  $role = ($Element.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '').ToLowerInvariant()
  if ($role -ne 'pane' -and $role -ne 'custom') { return $role }
  $legacy = $null
  try {
    if ($Element.TryGetCurrentPattern([Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacy)) {
      $legacyRole = [int]$legacy.Current.Role
      if ($legacyRole -eq 43) { return 'button' }
      if ($legacyRole -eq 41 -or $legacyRole -eq 42) { return 'text' }
      if ($legacyRole -eq 44) { return 'checkbox' }
      if ($legacyRole -eq 45) { return 'radio' }
    }
  } catch { }
  return $role
}

function Convert-Element($Element, [int]$Depth = 0, [int]$Index = -1) {
  $rect = $Element.Current.BoundingRectangle
  $node = [ordered]@{
    index = $Index
    name = $Element.Current.Name
    automation_id = $Element.Current.AutomationId
    role = Get-ElementRole $Element
    enabled = $Element.Current.IsEnabled
    offscreen = $Element.Current.IsOffscreen
    focusable = $Element.Current.IsKeyboardFocusable
    depth = $Depth
    rect = @{ x = $rect.X; y = $rect.Y; width = $rect.Width; height = $rect.Height }
  }
  return $node
}

function Inspect-Tree-Walker($Root, [int]$MaxNodes = 400, [int]$MaxDepth = 8, $Walker) {
  $queue = New-Object System.Collections.Queue
  # 用单对象装箱，避免 PowerShell 把数组拆进队列
  $queue.Enqueue([pscustomobject]@{ Element = $Root; Depth = 0 })
  $nodes = New-Object System.Collections.ArrayList
  while ($queue.Count -gt 0 -and $nodes.Count -lt $MaxNodes) {
    $entry = $queue.Dequeue()
    $element = $entry.Element
    $depth = Get-SafeInt $entry.Depth 0
    $index = $nodes.Count
    try { [void]$nodes.Add((Convert-Element $element $depth $index)) } catch { }
    if ($depth -ge $MaxDepth) { continue }
    try {
      $child = $Walker.GetFirstChild($element)
      while ($child -and $nodes.Count -lt $MaxNodes) {
        $queue.Enqueue([pscustomobject]@{ Element = $child; Depth = ($depth + 1) })
        $child = $Walker.GetNextSibling($child)
      }
    } catch { }
  }
  return ,@($nodes.ToArray())
}

function Inspect-Tree-Descendants($Root, [int]$MaxNodes = 400) {
  $nodes = New-Object System.Collections.ArrayList
  try { [void]$nodes.Add((Convert-Element $Root 0 0)) } catch { }
  try {
    $elements = $Root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    for ($i = 0; $i -lt $elements.Count -and $nodes.Count -lt $MaxNodes; $i++) {
      try {
        [void]$nodes.Add((Convert-Element $elements.Item($i) 1 $nodes.Count))
      } catch { }
    }
  } catch { }
  return ,@($nodes.ToArray())
}

function Inspect-Tree([long]$Handle, [int]$MaxNodes = 400, [int]$MaxDepth = 8) {
  $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Handle)
  if (-not $root) { throw 'UI Automation root not found' }

  $controlNodes = @(Inspect-Tree-Walker $root $MaxNodes $MaxDepth ([Windows.Automation.TreeWalker]::ControlViewWalker))
  if ($controlNodes.Count -gt 3) { return $controlNodes }

  $rawNodes = @(Inspect-Tree-Walker $root $MaxNodes $MaxDepth ([Windows.Automation.TreeWalker]::RawViewWalker))
  if ($rawNodes.Count -gt $controlNodes.Count) { $controlNodes = $rawNodes }
  if ($controlNodes.Count -gt 3) { return $controlNodes }

  $flat = @(Inspect-Tree-Descendants $root $MaxNodes)
  if ($flat.Count -ge $controlNodes.Count) { return $flat }
  return $controlNodes
}

function Find-Element-ByWalkerIndex($Root, [int]$TargetIndex, [int]$MaxDepth, $Walker) {
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue([pscustomobject]@{ Element = $Root; Depth = 0 })
  $current = 0
  while ($queue.Count -gt 0) {
    $entry = $queue.Dequeue()
    $element = $entry.Element
    $depth = Get-SafeInt $entry.Depth 0
    if ($current -eq $TargetIndex) { return $element }
    $current += 1
    if ($depth -ge $MaxDepth) { continue }
    try {
      $child = $Walker.GetFirstChild($element)
      while ($child) {
        $queue.Enqueue([pscustomobject]@{ Element = $child; Depth = ($depth + 1) })
        $child = $Walker.GetNextSibling($child)
      }
    } catch { }
  }
  return $null
}

function Find-Element-ByIndex($Root, [int]$TargetIndex, [int]$MaxDepth = 8) {
  if ($TargetIndex -lt 0) { return $null }

  $controlCount = (@(Inspect-Tree-Walker $Root 500 $MaxDepth ([Windows.Automation.TreeWalker]::ControlViewWalker))).Count
  if ($controlCount -gt 3) {
    return Find-Element-ByWalkerIndex $Root $TargetIndex $MaxDepth ([Windows.Automation.TreeWalker]::ControlViewWalker)
  }

  $rawCount = (@(Inspect-Tree-Walker $Root 500 $MaxDepth ([Windows.Automation.TreeWalker]::RawViewWalker))).Count
  if ($rawCount -gt 3) {
    return Find-Element-ByWalkerIndex $Root $TargetIndex $MaxDepth ([Windows.Automation.TreeWalker]::RawViewWalker)
  }

  if ($TargetIndex -eq 0) { return $Root }
  try {
    $elements = $Root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    $flatIndex = $TargetIndex - 1
    if ($flatIndex -ge 0 -and $flatIndex -lt $elements.Count) { return $elements.Item($flatIndex) }
  } catch { }
  return $null
}

function Test-ElementMatchesLocator($Element, $Locator) {
  if (-not $Element) { return $false }
  try {
    $name = [string]$Element.Current.Name
    $automationId = [string]$Element.Current.AutomationId
    $role = Get-ElementRole $Element
    if ($Locator.automation_id -and $automationId -ne [string]$Locator.automation_id) { return $false }
    if ($Locator.role -and $role -ne ([string]$Locator.role).ToLowerInvariant()) { return $false }
    if ($Locator.name -and $name.IndexOf([string]$Locator.name, [StringComparison]::OrdinalIgnoreCase) -lt 0) { return $false }
    if ($Locator.expected_rect) {
      $rect = $Element.Current.BoundingRectangle
      $expected = $Locator.expected_rect
      if ([Math]::Abs($rect.X - [double]$expected.x) -gt 12) { return $false }
      if ([Math]::Abs($rect.Y - [double]$expected.y) -gt 12) { return $false }
      if ([Math]::Abs($rect.Width - [double]$expected.width) -gt 20) { return $false }
      if ([Math]::Abs($rect.Height - [double]$expected.height) -gt 20) { return $false }
    }
    return $true
  } catch {
    return $false
  }
}

function Find-Element($Root, $Locator) {
  if ($null -ne $Locator.element_index -and "$($Locator.element_index)" -ne '') {
    $maxDepth = 8
    if ($Locator.max_depth) { $maxDepth = [int]$Locator.max_depth }
    $candidate = Find-Element-ByIndex $Root ([int]$Locator.element_index) $maxDepth
    if (Test-ElementMatchesLocator $candidate $Locator) { return $candidate }
    return $null
  }
  $elements = $Root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  for ($index = 0; $index -lt $elements.Count; $index++) {
    $element = $elements.Item($index)
    try {
      $name = [string]$element.Current.Name
      $automationId = [string]$element.Current.AutomationId
      $role = Get-ElementRole $element
      if ($Locator.automation_id -and $automationId -ne [string]$Locator.automation_id) { continue }
      if ($Locator.role -and $role -ne ([string]$Locator.role).ToLowerInvariant()) { continue }
      if ($Locator.name -and $name.IndexOf([string]$Locator.name, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
      return $element
    } catch { }
  }
  return $null
}

function Invoke-Element($Element, $Payload) {
  $pattern = $null
  $operation = ([string]$Payload.operation).ToLowerInvariant()
  if (-not $operation) { $operation = 'invoke' }
  if ($operation -eq 'set_value' -and $Element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
    $pattern.SetValue([string]$Payload.value)
    return 'set_value'
  }
  if ($operation -eq 'toggle' -and $Element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
    $pattern.Toggle()
    return 'toggle'
  }
  if ($operation -eq 'select' -and $Element.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    $pattern.Select()
    return 'select'
  }
  if (($operation -eq 'expand' -or $operation -eq 'collapse') -and $Element.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
    if ($operation -eq 'expand') { $pattern.Expand() } else { $pattern.Collapse() }
    return $operation
  }
  if ($operation -eq 'focus') {
    try { $Element.SetFocus(); return 'focus' } catch { }
  }
  if ($Element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
    return 'invoke'
  }
  if ($operation -eq 'invoke') {
    $pattern = $null
    if ($Element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
      $pattern.Toggle()
      return 'toggle'
    }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
      $pattern.Select()
      return 'select'
    }
    $pattern = $null
    if ($Element.TryGetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$pattern)) {
      if ($pattern.Current.ExpandCollapseState -eq [Windows.Automation.ExpandCollapseState]::Collapsed) {
        $pattern.Expand()
        return 'expand'
      }
      $pattern.Collapse()
      return 'collapse'
    }
  }
  $pattern = $null
  if ($Element.TryGetCurrentPattern([Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$pattern)) {
    $pattern.DoDefaultAction()
    return 'legacy_default_action'
  }
  throw 'Element does not expose a supported semantic action pattern'
}

function Build-WindowRecord($window, $process) {
  $exe = if ($process) { [string]$process.ExecutablePath } else { '' }
  $appName = if ($process -and $process.Name) { [string]$process.Name } else { '' }
  if (-not $appName -and $exe) { $appName = [IO.Path]::GetFileName($exe) }
  return [ordered]@{
    id = [string]$window.Handle
    handle = $window.Handle
    process_id = $window.ProcessId
    title = $window.Title
    executable_path = $exe
    app = $appName
  }
}

function Ensure-Window([long]$Handle) {
  if (-not [LingxiNativeWindows]::WindowExists($Handle)) {
    throw 'Window handle is no longer valid'
  }
}

function Get-WindowRelativePointFromElement($Element, [long]$Handle) {
  $rect = $Element.Current.BoundingRectangle
  if ($rect.Width -le 0 -or $rect.Height -le 0) {
    throw 'Element has empty bounding rectangle'
  }
  $left = 0; $top = 0; $width = 0; $height = 0
  if (-not [LingxiNativeWindows]::GetBounds($Handle, [ref]$left, [ref]$top, [ref]$width, [ref]$height)) {
    throw 'Failed to get window bounds'
  }
  $centerX = [int]([Math]::Round($rect.X + $rect.Width / 2.0))
  $centerY = [int]([Math]::Round($rect.Y + $rect.Height / 2.0))
  return @{
    x = $centerX - $left
    y = $centerY - $top
    screen_x = $centerX
    screen_y = $centerY
  }
}

function Get-FocusedAccessibility($Root) {
  $result = [ordered]@{
    focused_element = $null
    selected_text = $null
    selected_elements = @()
    document_text = $null
  }
  try {
    $focused = [Windows.Automation.AutomationElement]::FocusedElement
    if ($focused) {
      # 注意：-1 必须括号包裹，否则 PowerShell 会当成参数名
      $node = Convert-Element $focused 0 (-1)
      $result.focused_element = "[focus] $($node.role): $($node.name)"
      try {
        $tp = $null
        if ($focused.TryGetCurrentPattern([Windows.Automation.TextPattern]::Pattern, [ref]$tp)) {
          $sel = $tp.GetSelection()
          if ($sel -and $sel.Length -gt 0) {
            $result.selected_text = $sel[0].GetText(500)
          }
        }
      } catch { }
    }
  } catch { }
  return $result
}

try {
  $payload = Read-Payload
  if ($Action -eq 'list') {
    $processes = Get-ProcessTable
    $filterIds = $null
    if ($payload.root_process_id) {
      $filterIds = Get-DescendantProcessIds ([int]$payload.root_process_id) $processes
    }
    $windows = foreach ($window in [LingxiNativeWindows]::List()) {
      if ($filterIds -and -not (@($filterIds) -contains [int]$window.ProcessId)) { continue }
      $process = $processes | Where-Object { $_.ProcessId -eq $window.ProcessId } | Select-Object -First 1
      Build-WindowRecord $window $process
    }
    @{ success = $true; windows = @($windows) } | ConvertTo-Json -Depth 6 -Compress
    exit 0
  }

  if ($Action -eq 'inspect') {
    $maxNodes = Get-SafeInt $payload.max_nodes 400
    if ($maxNodes -lt 1) { $maxNodes = 400 }
    $maxDepth = Get-SafeInt $payload.max_depth 8
    if ($maxDepth -lt 1) { $maxDepth = 8 }
    $handle = Get-SafeLong $payload.handle 0
    Ensure-Window $handle
    $wasMinimized = [LingxiNativeWindows]::IsMinimized($handle)
    $recovered = $false
    if ($wasMinimized) {
      $recovered = [LingxiNativeWindows]::Activate($handle)
      Start-Sleep -Milliseconds 120
    }
    $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
    $nodes = @(Inspect-Tree $handle $maxNodes $maxDepth)
    $treeLines = New-Object System.Collections.ArrayList
    foreach ($node in $nodes) {
      if ($null -eq $node) { continue }
      $depth = Get-SafeInt $node.depth 0
      $index = Get-SafeInt $node.index (-1)
      $indent = ('  ' * [Math]::Max(0, $depth))
      $label = if ($node.name) { [string]$node.name } else { '(unnamed)' }
      $role = if ($node.role) { [string]$node.role } else { 'unknown' }
      $aid = if ($node.automation_id) { " id=$($node.automation_id)" } else { '' }
      [void]$treeLines.Add("${indent}[$index] ${role}: ${label}${aid}")
    }
    $focusInfo = Get-FocusedAccessibility $root
    @{
      success = $true
      window_was_minimized = $wasMinimized
      window_recovered_from_minimized = $recovered
      nodes = @($nodes)
      tree = ($treeLines -join "`n")
      node_count = @($nodes).Count
      focused_element = $focusInfo.focused_element
      selected_text = $focusInfo.selected_text
      selected_elements = @($focusInfo.selected_elements)
      document_text = $focusInfo.document_text
    } | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }

  if ($Action -eq 'action') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
    $locator = $payload.locator
    if (-not $locator) { $locator = [pscustomobject]@{} }
    if ($null -ne $payload.element_index -and "$($payload.element_index)" -ne '') {
      $locator | Add-Member -NotePropertyName element_index -NotePropertyValue $payload.element_index -Force
    }
    if ($payload.max_depth) {
      $locator | Add-Member -NotePropertyName max_depth -NotePropertyValue $payload.max_depth -Force
    }
    $element = Find-Element $root $locator
    if (-not $element) {
      @{ success = $false; found = $false; error = 'UI Automation element not found' } | ConvertTo-Json -Compress
      exit 0
    }
    $before = Convert-Element $element 0 ([int]-1)
    if ($null -ne $payload.element_index -and "$($payload.element_index)" -ne '') {
      $before.index = [int]$payload.element_index
    }
    $performed = Invoke-Element $element $payload
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
    @{ success = $true; found = $true; performed = $performed; element = $before } | ConvertTo-Json -Depth 6 -Compress
    exit 0
  }

  if ($Action -eq 'click') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    $button = if ($payload.mouse_button) { [string]$payload.mouse_button } else { 'left' }
    $clickCount = if ($payload.click_count) { [int]$payload.click_count } else { 1 }
    $x = $null
    $y = $null
    if ($null -ne $payload.element_index -and "$($payload.element_index)" -ne '') {
      $root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$handle)
      $locator = $payload.locator
      if (-not $locator) { $locator = [pscustomobject]@{} }
      $locator | Add-Member -NotePropertyName element_index -NotePropertyValue $payload.element_index -Force
      if ($payload.max_depth) { $locator | Add-Member -NotePropertyName max_depth -NotePropertyValue $payload.max_depth -Force }
      $element = Find-Element $root $locator
      if (-not $element) {
        @{ success = $false; found = $false; error = 'UI Automation element not found for click' } | ConvertTo-Json -Compress
        exit 0
      }
      # Prefer UI Automation patterns: these can work even when another normal window covers the target.
      if ($button -eq 'left' -and $clickCount -le 1) {
        try {
          $semanticPayload = [pscustomobject]@{ operation = 'invoke'; value = '' }
          $performed = Invoke-Element $element $semanticPayload
          Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
          @{ success = $true; performed = $performed; mode = 'element_index'; element_index = [int]$payload.element_index } | ConvertTo-Json -Compress
          exit 0
        } catch {
          # The control has no supported semantic pattern; guarded coordinate click is the fallback.
        }
      }
      $pt = Get-WindowRelativePointFromElement $element $handle
      $x = [int]$pt.x
      $y = [int]$pt.y
    } else {
      if ($null -eq $payload.x -or $null -eq $payload.y) {
        @{ success = $false; error = 'click requires element_index or x+y' } | ConvertTo-Json -Compress
        exit 0
      }
      $x = [int][Math]::Round([double]$payload.x)
      $y = [int][Math]::Round([double]$payload.y)
    }
    [LingxiNativeWindows]::ClickAtWindow($handle, $x, $y, $button, $clickCount)
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
    @{ success = $true; performed = 'click'; x = $x; y = $y; mouse_button = $button; click_count = $clickCount } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'drag') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    if ($null -eq $payload.from_x -or $null -eq $payload.from_y -or $null -eq $payload.to_x -or $null -eq $payload.to_y) {
      @{ success = $false; error = 'drag requires from_x, from_y, to_x, to_y' } | ConvertTo-Json -Compress
      exit 0
    }
    $fromX = [int][Math]::Round([double]$payload.from_x)
    $fromY = [int][Math]::Round([double]$payload.from_y)
    $toX = [int][Math]::Round([double]$payload.to_x)
    $toY = [int][Math]::Round([double]$payload.to_y)
    [LingxiNativeWindows]::DragWindow($handle, $fromX, $fromY, $toX, $toY)
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
    @{ success = $true; performed = 'drag'; from_x = $fromX; from_y = $fromY; to_x = $toX; to_y = $toY } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'scroll') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    if ($null -eq $payload.x -or $null -eq $payload.y) {
      @{ success = $false; error = 'scroll requires x and y (window-relative)' } | ConvertTo-Json -Compress
      exit 0
    }
    $x = [int][Math]::Round([double]$payload.x)
    $y = [int][Math]::Round([double]$payload.y)
    $scrollX = if ($null -ne $payload.scrollX) { [int][Math]::Round([double]$payload.scrollX) } elseif ($null -ne $payload.scroll_x) { [int][Math]::Round([double]$payload.scroll_x) } else { 0 }
    $scrollY = if ($null -ne $payload.scrollY) { [int][Math]::Round([double]$payload.scrollY) } elseif ($null -ne $payload.scroll_y) { [int][Math]::Round([double]$payload.scroll_y) } else { 0 }
    [LingxiNativeWindows]::ScrollWindow($handle, $x, $y, $scrollX, $scrollY)
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
    @{ success = $true; performed = 'scroll'; x = $x; y = $y; scrollX = $scrollX; scrollY = $scrollY } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'type_text') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    $text = if ($null -ne $payload.text) { [string]$payload.text } else { '' }
    [LingxiNativeWindows]::TypeText($handle, $text)
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
    @{ success = $true; performed = 'type_text'; length = $text.Length } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'press_key') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    $key = [string]$payload.key
    if (-not $key) {
      @{ success = $false; error = 'press_key requires key' } | ConvertTo-Json -Compress
      exit 0
    }
    $beforeMinimized = [LingxiNativeWindows]::IsMinimized($handle)
    [LingxiNativeWindows]::PressKeyChord($handle, $key)
    Start-Sleep -Milliseconds ([Math]::Min([Math]::Max([int]$payload.wait_after_ms, 0), 3000))
    $afterMinimized = [LingxiNativeWindows]::IsMinimized($handle)
    $unexpectedStateChange = (-not $beforeMinimized) -and $afterMinimized
    $recovered = $false
    if ($unexpectedStateChange) {
      $recovered = [LingxiNativeWindows]::Activate($handle)
      Start-Sleep -Milliseconds 120
    }
    @{
      success = $true
      performed = 'press_key'
      key = $key
      key_injected = $true
      effect_verified = $false
      before_minimized = $beforeMinimized
      after_minimized = $afterMinimized
      unexpected_window_state_change = $unexpectedStateChange
      recovered = $recovered
    } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'capture') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    $wasMinimized = [LingxiNativeWindows]::IsMinimized($handle)
    $recovered = $false
    if ($wasMinimized) {
      $recovered = [LingxiNativeWindows]::Activate($handle)
      Start-Sleep -Milliseconds 120
    }
    @{
      success = $true
      png = [LingxiNativeWindows]::CapturePngBase64($handle)
      window_was_minimized = $wasMinimized
      window_recovered_from_minimized = $recovered
    } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'activate') {
    $ok = [LingxiNativeWindows]::Activate([long]$payload.handle)
    @{ success = $ok; activated = $ok } | ConvertTo-Json -Compress
    exit 0
  }

  if ($Action -eq 'bounds') {
    $handle = [long]$payload.handle
    Ensure-Window $handle
    $left = 0; $top = 0; $width = 0; $height = 0
    if (-not [LingxiNativeWindows]::GetBounds($handle, [ref]$left, [ref]$top, [ref]$width, [ref]$height)) {
      @{ success = $false; error = 'GetBounds failed' } | ConvertTo-Json -Compress
      exit 0
    }
    @{ success = $true; left = $left; top = $top; width = $width; height = $height } | ConvertTo-Json -Compress
    exit 0
  }

  throw "Unknown action: $Action"
} catch {
  @{ success = $false; error = $_.Exception.Message; stack = $_.ScriptStackTrace } | ConvertTo-Json -Depth 4 -Compress
  exit 1
}
