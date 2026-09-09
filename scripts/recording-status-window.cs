// このPCの録音表示。表示操作は録音プロセスに触れない。
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace Katazuku {
    internal static class RecordingCaptureVisibility {
        private const uint ExcludeFromCapture = 0x00000011;
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWindowDisplayAffinity(IntPtr window, uint affinity);
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowDisplayAffinity(IntPtr window, out uint affinity);
        internal static bool IsExcluded(IntPtr window) {
            uint affinity;
            return GetWindowDisplayAffinity(window, out affinity) && affinity == ExcludeFromCapture;
        }
        internal static bool Exclude(IntPtr window) {
            return SetWindowDisplayAffinity(window, ExcludeFromCapture) && IsExcluded(window);
        }
    }
    internal sealed class RecordingStatusMenu : ContextMenuStrip {
        protected override void OnHandleCreated(EventArgs args) {
            base.OnHandleCreated(args);
            RecordingCaptureVisibility.Exclude(Handle);
        }
        protected override void OnOpening(System.ComponentModel.CancelEventArgs args) {
            base.OnOpening(args);
            if (!RecordingCaptureVisibility.Exclude(Handle)) args.Cancel = true;
        }
    }
    public sealed class RecordingStatusWindow : Form {
        private readonly Label heading = new Label();
        private readonly Label elapsed = new Label();
        private readonly Label detail = new Label();
        private readonly Label brand = new Label();
        private readonly NotifyIcon tray = new NotifyIcon();
        private Color accent = Color.FromArgb(110, 117, 124);
        private bool exitRequested;
        private const int ToggleHotKeyId = 0x4B52;
        private readonly bool enableGlobalHotKey;
        private readonly HashSet<string> observedSessions = new HashSet<string>(StringComparer.Ordinal);
        private ToolStripMenuItem toggleItem;
        public bool HotKeyRegistered { get; private set; }
        public string HotKeyText { get; private set; }
        public int HotKeyError { get; private set; }
        public bool CaptureExcluded { get { return IsHandleCreated && RecordingCaptureVisibility.IsExcluded(Handle); } }
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool UnregisterHotKey(IntPtr window, int id);
        [DllImport("user32.dll")] private static extern bool ReleaseCapture();
        [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
        protected override bool ShowWithoutActivation { get { return true; } }
        protected override void OnHandleCreated(EventArgs args) {
            base.OnHandleCreated(args);
            // 画面共有・録画から小窓を除外し、本人のモニターには表示する。
            // ウィンドウが再生成されたときも、同じ設定を必ず適用する。
            RecordingCaptureVisibility.Exclude(Handle);
            RegisterToggleHotKey();
        }
        protected override void OnHandleDestroyed(EventArgs args) {
            ReleaseToggleHotKey();
            base.OnHandleDestroyed(args);
        }
        protected override void OnVisibleChanged(EventArgs args) {
            base.OnVisibleChanged(args);
            // 除外を設定できない環境では通知領域だけに留め、共有へ小窓を出さない。
            if (Visible && IsHandleCreated && !CaptureExcluded && !RecordingCaptureVisibility.Exclude(Handle)) Hide();
        }
        protected override void WndProc(ref Message message) {
            if (message.Msg == 0x0312 && message.WParam.ToInt32() == ToggleHotKeyId) {
                ToggleDisplay();
                return;
            }
            // 会議中の入力先を奪わず、表示のドラッグやメニューだけ受け取る。
            if (message.Msg == 0x0021) { message.Result = new IntPtr(3); return; }
            base.WndProc(ref message);
        }
        public RecordingStatusWindow() : this(true, true) { }
        public RecordingStatusWindow(bool showTray) : this(showTray, showTray) { }
        public RecordingStatusWindow(bool showTray, bool enableHotKey) {
            enableGlobalHotKey = enableHotKey;
            HotKeyText = "Ctrl + Alt + Shift + R";
            Text = "katazuku 録音状態";
            AccessibleName = Text;
            AutoScaleDimensions = new SizeF(96, 96);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(336, 104);
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            ShowInTaskbar = false;
            TopMost = true;
            DoubleBuffered = true;
            BackColor = Color.White;
            Font = new Font(SystemFonts.MessageBoxFont.FontFamily, 10);
            var work = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(work.Right - Width - 20, work.Bottom - Height - 20);
            Configure(brand, "katazuku  /  このPCの録音", 16, 10, 276, 20, 9, false);
            brand.ForeColor = Color.FromArgb(96, 103, 110);
            Configure(heading, "状態を確認中", 32, 34, 223, 28, 12, true);
            Configure(elapsed, "", 255, 36, 65, 25, 10, true);
            elapsed.TextAlign = ContentAlignment.MiddleRight;
            Configure(detail, "録音の状態を読み取っています", 16, 69, 308, 24, 9, false);
            detail.ForeColor = Color.FromArgb(75, 82, 89);
            var hide = new Label { Text = "−", Location = new Point(299, 5), Size = new Size(30, 25), TextAlign = ContentAlignment.MiddleCenter, Cursor = Cursors.Hand, AccessibleName = "表示を隠す（録音は継続）" };
            hide.Click += delegate { Hide(); };
            Controls.Add(hide);
            var menu = new RecordingStatusMenu();
            toggleItem = new ToolStripMenuItem("表示 / 非表示", null, delegate { ToggleDisplay(); });
            toggleItem.ShortcutKeyDisplayString = HotKeyText;
            menu.Items.Add(toggleItem);
            menu.Items.Add(new ToolStripMenuItem("録音開始時は自動で表示") { Enabled = false });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("表示だけ終了", null, delegate { exitRequested = true; Close(); });
            ContextMenuStrip = menu;
            tray.Icon = SystemIcons.Information;
            tray.Text = "katazuku / 録音状態を確認中";
            tray.ContextMenuStrip = menu;
            tray.Visible = showTray;
            tray.DoubleClick += delegate { ToggleDisplay(); };
            MouseDown += DragWindow;
            foreach (Control control in new Control[] { heading, detail, elapsed, brand }) { control.MouseDown += DragWindow; }
        }
        private void RegisterToggleHotKey() {
            if (!enableGlobalHotKey || HotKeyRegistered) return;
            // Ctrl+Alt+Rは実機で競合したためShift付きで固定する。再起動でもキーを変えない。
            // MOD_NOREPEATで長押しによる連続切替を抑止する。
            uint modifiers = 0x0001 | 0x0002 | 0x0004 | 0x4000;
            HotKeyRegistered = RegisterHotKey(Handle, ToggleHotKeyId, modifiers, 0x52);
            HotKeyError = HotKeyRegistered ? 0 : Marshal.GetLastWin32Error();
            if (toggleItem != null) toggleItem.ShortcutKeyDisplayString = HotKeyRegistered ? HotKeyText : "キー競合あり";
        }
        private void ReleaseToggleHotKey() {
            if (HotKeyRegistered && IsHandleCreated) UnregisterHotKey(Handle, ToggleHotKeyId);
            HotKeyRegistered = false;
        }
        public void ToggleDisplay() {
            if (Visible) Hide(); else Show();
        }
        private void Configure(Label label, string text, int x, int y, int width, int height, float size, bool bold) {
            label.Text = text;
            label.SetBounds(x, y, width, height);
            label.Font = new Font(SystemFonts.MessageBoxFont.FontFamily, size, bold ? FontStyle.Bold : FontStyle.Regular);
            label.AutoEllipsis = true;
            Controls.Add(label);
        }
        private void DragWindow(object sender, MouseEventArgs args) {
            if (args.Button != MouseButtons.Left) return;
            ReleaseCapture();
            SendMessage(Handle, 0x00A1, new IntPtr(2), IntPtr.Zero);
        }
        public void DisplayStatus(string state, string label, string description, int seconds) {
            DisplayStatus(state, label, description, seconds, null);
        }
        public void DisplayStatus(string state, string label, string description, int seconds, string[] sessionIds) {
            // 同じ録音の更新・復旧では、本人が選んだ非表示を維持する。
            // 新しい録音を検出したときだけ表示へ戻す。
            bool newRecording = false;
            if (sessionIds != null) {
                foreach (string sessionId in sessionIds) {
                    if (!string.IsNullOrEmpty(sessionId) && observedSessions.Add(sessionId)) newRecording = true;
                }
            }
            if (newRecording) Show();
            Text = "katazuku / " + label;
            heading.Text = label;
            detail.Text = description;
            elapsed.Text = state == "recording" ? string.Format("{0:00}:{1:00}", seconds / 60, seconds % 60) : "";
            accent = state == "recording" ? Color.FromArgb(0, 112, 192) :
                (state == "stalled" || state == "unknown" ? Color.FromArgb(180, 74, 0) : Color.FromArgb(110, 117, 124));
            heading.ForeColor = accent;
            tray.Text = ("katazuku / " + label + (HotKeyRegistered ? " / " + HotKeyText : ""));
            Invalidate();
        }
        protected override void OnPaint(PaintEventArgs args) {
            base.OnPaint(args);
            args.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var border = new Pen(Color.FromArgb(196, 202, 208))) { args.Graphics.DrawRectangle(border, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1); }
            float scale = ClientSize.Width / 336f;
            using (var brush = new SolidBrush(accent)) { args.Graphics.FillEllipse(brush, 16 * scale, 44 * scale, 9 * scale, 9 * scale); }
        }
        protected override void OnFormClosing(FormClosingEventArgs args) {
            if (!exitRequested && args.CloseReason == CloseReason.UserClosing) { args.Cancel = true; Hide(); return; }
            base.OnFormClosing(args);
        }
        protected override void Dispose(bool disposing) {
            if (disposing) { ReleaseToggleHotKey(); tray.Visible = false; tray.Dispose(); }
            base.Dispose(disposing);
        }
    }
}
