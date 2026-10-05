// Google審査の実演用。録画はブラウザが本人に選択させた画面だけを取得し、端末へ保存する。
const start = document.getElementById('record-start');
if (start) {
  const stop = document.getElementById('record-stop');
  const status = document.getElementById('record-status');
  const download = document.getElementById('record-download');
  let recording;
  let media;
  let timer;
  let output;
  let frames = [];
  const finish = () => {
    if (recording?.state === 'recording') recording.stop();
    media?.getTracks().forEach(track => track.stop());
    clearTimeout(timer);
  };
  start.addEventListener('click', async () => {
    start.disabled = true;
    try {
      media = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'window', frameRate: 20 }, audio: false,
        systemAudio: 'exclude', selfBrowserSurface: 'include' });
      // ブラウザタブだけの録画ではGoogleが要求するアドレスバーが映らない。
      if (media.getVideoTracks()[0].getSettings().displaySurface === 'browser') {
        media.getTracks().forEach(track => track.stop());
        throw new Error('アドレスバーも映るChromeのウィンドウを選んでください。');
      }
      const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('このブラウザではWebM録画が利用できません。');
      frames = [];
      recording = new MediaRecorder(media, { mimeType, videoBitsPerSecond: 5_000_000 });
      recording.addEventListener('dataavailable', event => { if (event.data.size) frames.push(event.data); });
      recording.addEventListener('stop', () => {
        if (output) URL.revokeObjectURL(output);
        output = URL.createObjectURL(new Blob(frames, { type: mimeType }));
        download.href = output;
        download.download = 'katazuku-google-demo-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm';
        download.hidden = false;
        frames = [];
        stop.disabled = true;
        start.disabled = false;
        status.textContent = '録画を停止しました。動画をPCへ保存し、実際の認証・操作と不要な個人情報が映っていないか確認してください。';
      });
      media.getVideoTracks()[0].addEventListener('ended', finish, { once: true });
      recording.start(1000);
      download.hidden = true;
      stop.disabled = false;
      status.textContent = '録画中です。このタブを開いたまま、Googleの同意と各機能の実演を進めてください。音声は録音しません。';
      timer = setTimeout(finish, 15 * 60_000);
    } catch (error) {
      media?.getTracks().forEach(track => track.stop());
      status.textContent = error.name === 'NotAllowedError' ? '画面共有が許可されませんでした。' : '録画を開始できませんでした。Chromeのウィンドウを選択してください。';
      start.disabled = false;
    }
  });
  stop.addEventListener('click', finish);
  addEventListener('beforeunload', event => { if (recording?.state === 'recording') { event.preventDefault(); event.returnValue = ''; } });
}
