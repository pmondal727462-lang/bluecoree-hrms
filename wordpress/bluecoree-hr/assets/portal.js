(() => {
  'use strict';
  const root = document.getElementById('bluecoree-hr');
  if (!root) return;
  const config = window.BlueCoreeHR;
  let stream;
  let timer;
  let busy = false;
  let generation = 0;
  let face;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  async function api(path, body) {
    const response = await fetch(config.api + path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: { 'X-WP-Nonce': config.nonce, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    if (!response.ok || !value.success) throw new Error(value.message || 'Request failed. Please refresh and sign in again if needed.');
    return value.data;
  }
  const localTime = (value, timezone) => value ? new Date(value.replace(' ', 'T') + 'Z').toLocaleTimeString([], { timeZone: timezone, hour: '2-digit', minute: '2-digit' }) : '—';
  function message(text, error = false) {
    const status = root.querySelector('[role=status]');
    if (status) { status.textContent = text; status.classList.toggle('error', error); }
  }
  function stop() {
    generation++;
    clearTimeout(timer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    const camera = root.querySelector('#bchr-camera');
    if (camera) camera.hidden = true;
  }
  function controls(disabled) {
    root.querySelectorAll('button').forEach((button) => { button.disabled = disabled; });
  }
  async function scan() {
    if (busy || stream) return;
    if (!face.enrolled && !root.querySelector('#bchr-consent')?.checked) return message('Please consent before registering your face.', true);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return message('Open this site over HTTPS in a browser with camera support.', true);
    stop();
    const current = generation;
    controls(true);
    root.querySelector('#bchr-cancel').disabled = false;
    try {
      const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (generation !== current) { opened.getTracks().forEach((track) => track.stop()); return; }
      stream = opened;
      root.querySelector('#bchr-camera').hidden = false;
      const video = root.querySelector('video');
      video.srcObject = stream;
      await video.play();
      if (generation !== current) return;
      message('Keep your face in view. Capturing automatically in two seconds…');
      timer = setTimeout(async () => {
        if (generation !== current) return;
        busy = true;
        controls(true);
        try {
          if (!video.videoWidth || !video.videoHeight) throw new Error('Camera is not ready. Please retry.');
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = Math.round(640 * video.videoHeight / video.videoWidth);
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          const sample = canvas.toDataURL('image/jpeg', 0.7);
          canvas.width = canvas.height = 0;
          stop();
          if (sample.length > 350000) throw new Error('Image is too large. Please try again.');
          message('Verifying your face securely…');
          const enroll = !face.enrolled;
          const result = await api(enroll ? 'face/enroll' : 'attendance/face-punch', { faceSample: sample, ...(enroll ? { consent: true } : {}) });
          await load();
          message(enroll ? 'Face registered. Start another scan to record attendance.' : `${result.action === 'CHECK_IN' ? 'Check-in' : 'Check-out'} saved.`);
        } catch (error) { message(error.message, true); }
        finally { busy = false; controls(false); }
      }, 2000);
    } catch (error) { if (generation === current) { stop(); controls(false); message(error.message, true); } }
  }
  async function load() {
    const [profile, status, attendance] = await Promise.all([api('profile'), api('face/status'), api('attendance')]);
    face = status;
    root.innerHTML = `<h2>Welcome, ${escape(profile.name)}</h2><p>${escape(profile.company)} · ${escape(profile.plan)} plan</p>
      <h3>My profile</h3><dl>${[['Employee code', profile.employeeCode], ['Login email', profile.email], ['Department', profile.department], ['Designation', profile.designation]].map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value || '—')}</dd>`).join('')}</dl>
      <h3>My attendance</h3><p>Check-in: ${escape(localTime(attendance.current?.check_in, attendance.timezone))} · Check-out: ${escape(localTime(attendance.current?.check_out, attendance.timezone))}</p>
      <p role="status">${status.providerConfigured ? 'First verified scan records check-in. Later scans update check-out.' : 'Face attendance is awaiting verification service setup. Contact HR.'}</p>
      ${!status.enrolled && status.providerConfigured ? '<label><input id="bchr-consent" type="checkbox"> I consent to an encrypted face template being stored on the HRMS server for attendance verification.</label>' : ''}
      ${status.providerConfigured ? `<button id="bchr-scan">${status.enrolled ? 'Start face attendance' : 'Register my face'}</button>` : ''}
      <div id="bchr-camera" hidden><video autoplay playsinline muted></video><button id="bchr-cancel">Cancel</button></div>
      <h3>Attendance history</h3><div class="history"><table><thead><tr><th>Work date</th><th>Check-in</th><th>Check-out</th></tr></thead><tbody>${attendance.items.map((item) => `<tr><td>${escape(item.work_date)}</td><td>${escape(localTime(item.check_in, attendance.timezone))}</td><td>${escape(localTime(item.check_out, attendance.timezone))}</td></tr>`).join('') || '<tr><td colspan="3">No attendance yet.</td></tr>'}</tbody></table></div>
      <p>Times shown in ${escape(attendance.timezone)}. Each scan requires a new live camera capture.</p><a href="${escape(config.logout)}">Sign out</a>`;
    root.querySelector('#bchr-scan')?.addEventListener('click', scan);
    root.querySelector('#bchr-cancel')?.addEventListener('click', () => { if (!busy) { stop(); controls(false); message('Scan cancelled.'); } });
  }
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stop(); if (!busy) controls(false); } });
  load().catch((error) => message(error.message, true));
})();
