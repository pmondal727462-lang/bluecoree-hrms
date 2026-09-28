/* Shared by the cached employee clock and the signed-in workspace. */
const DATABASE = "bluecoreehr-offline-attendance-v1";
const page = document.getElementById("clock-in") !== null;
let database,
  profile = null,
  stream = null,
  capturing = false,
  syncing = false;
const element = (id) => document.getElementById(id);
const owner = (p) => `${p.companyId}:${p.userId}`;
const message = (text, error = false) => {
  if (page) {
    element("message").textContent = text;
    element("message").className = error ? "error" : "";
  }
};
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("meta");
      db.createObjectStore("profiles", { keyPath: "owner" });
      db.createObjectStore("events", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Device storage is unavailable. Allow site storage before using offline attendance.",
        ),
      );
  });
}
function read(store, key) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store);
    const r =
      key === undefined
        ? tx.objectStore(store).getAll()
        : tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
function write(store, value, key) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(store, "readwrite");
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(
        new Error(
          "Could not save to this device. Free some storage and retry.",
        ),
      );
    tx.onabort = () =>
      reject(
        new Error("Device storage was interrupted. This punch was not saved."),
      );
  });
}
function locked(name, work) {
  return navigator.locks
    ? navigator.locks.request(`bluecoreehr:${name}`, work)
    : work();
}
async function key() {
  return locked("storage-key", async () => {
    let value = await read("meta", "encryption-key");
    if (!value) {
      value = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
      await write("meta", value, "encryption-key");
    }
    return value;
  });
}
async function seal(data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return {
    iv,
    data: await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await key(),
      new TextEncoder().encode(JSON.stringify(data)),
    ),
  };
}
async function unseal(value) {
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: value.iv },
        await key(),
        value.data,
      ),
    ),
  );
}
async function request(path, body, retry = true) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 25000);
  let response;
  try {
    response = await fetch(`/api/${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw Object.assign(
      new Error(
        "Connection unavailable. Your saved punches will retry automatically.",
      ),
      { network: true },
    );
  } finally {
    clearTimeout(timeout);
  }
  if (response.status === 401 && retry) {
    const refreshed = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(25000),
    }).catch(() => null);
    if (refreshed?.ok) return request(path, body, false);
  }
  const result = await response
    .json()
    .catch(() => ({ message: "The server could not process this request." }));
  if (!response.ok)
    throw Object.assign(
      new Error(
        response.status === 401
          ? "Sign in as the prepared employee to sync your saved punches."
          : result.message || "Sync failed.",
      ),
      { status: response.status },
    );
  return result.data;
}
async function rows() {
  return (await read("events"))
    .filter((e) => profile && e.owner === owner(profile))
    .sort(
      (a, b) =>
        a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id),
    );
}
async function render() {
  if (!page) return;
  element("network").textContent = navigator.onLine
    ? "Connection available"
    : "Offline · saving on device";
  const events = await rows();
  const pending = events.filter((e) => e.status !== "SYNCED");
  const valid =
    profile &&
    Date.now() + (profile.offset || 0) <= Date.parse(profile.expiresAt);
  element("employee").textContent = profile
    ? `${profile.name} · ${profile.employeeCode}`
    : "Prepare your offline clock";
  element("ready").textContent = profile
    ? `Prepared on this device until ${new Date(profile.expiresAt).toLocaleString()}.`
    : "Sign in online once, then choose Refresh offline access. Bookmark this page for poor-network sites.";
  // Local pending punches take precedence over the last server snapshot.
  const last = pending.at(-1),
    checkedIn = last ? last.direction === "IN" : !!profile?.checkedIn;
  element("clock-in").disabled = !valid || capturing || checkedIn;
  element("clock-out").disabled = !valid || capturing || !checkedIn;
  element("camera-area").hidden = !profile?.faceRequired;
  element("sync").disabled = syncing || !pending.length || !navigator.onLine;
  element("queue-summary").textContent =
    `${pending.length} pending · ${events.filter((e) => e.status === "SYNCED").length} synced on this device`;
  const list = element("queue");
  list.replaceChildren();
  for (const event of events.slice(-50).reverse()) {
    const item = document.createElement("li"),
      title = document.createElement("strong"),
      details = document.createElement("small");
    title.textContent = `${event.direction === "IN" ? "Check-in" : "Check-out"} · ${new Date(event.capturedAt).toLocaleString(undefined, { timeZone: profile.timezone })}`;
    details.textContent =
      event.status === "SYNCED"
        ? "Synced — recorded in attendance."
        : event.error || "Saved on device — awaiting sync and verification.";
    item.append(title, details);
    list.append(item);
  }
}
async function worker() {
  if (!("serviceWorker" in navigator) || !crypto.subtle)
    throw new Error(
      "Offline attendance needs HTTPS (or localhost) and a browser with offline storage support.",
    );
  const registration = await navigator.serviceWorker.register(
    "/offline/sw.js",
    { scope: "/offline/" },
  );
  if (!registration.active)
    await new Promise((resolve, reject) => {
      const installing = registration.installing || registration.waiting;
      if (!installing)
        return reject(new Error("Offline page could not be prepared."));
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              "Offline page preparation timed out. Retry while connected.",
            ),
          ),
        15000,
      );
      installing.addEventListener("statechange", () => {
        if (installing.state === "activated") {
          clearTimeout(timer);
          resolve();
        } else if (installing.state === "redundant") {
          clearTimeout(timer);
          reject(
            new Error(
              "Offline page could not be cached. Retry while connected.",
            ),
          );
        }
      });
    });
}
async function prepare() {
  await worker();
  const me = await request("auth/me");
  if (
    !me.permissions.includes("attendance.self") ||
    me.passwordChangeRequired ||
    me.mfaSetupRequired
  )
    throw new Error(
      "Complete your employee sign-in and security setup to prepare offline attendance.",
    );
  let deviceId = await read("meta", "device");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    await write("meta", deviceId, "device");
  }
  const next = await request(
    `time/offline-permit?deviceId=${encodeURIComponent(deviceId)}`,
  );
  next.offset = Date.parse(next.serverTime) - Date.now();
  await write("profiles", { owner: owner(next), ...(await seal(next)) });
  await write("meta", owner(next), "active");
  profile = next;
  message(
    "Offline clock is ready on this device. You can now record punches without a connection.",
  );
  await render();
}
async function location() {
  if (!profile.gpsRequired) return undefined;
  if (!navigator.geolocation)
    throw new Error(
      "This company requires GPS, but this device cannot provide it.",
    );
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      () =>
        reject(
          new Error(
            "GPS is required by your attendance policy. Enable location and try again.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 25000 },
    ),
  );
}
function face() {
  if (!profile.faceRequired) return undefined;
  const video = element("camera");
  if (!stream || !video.videoWidth)
    throw new Error("Open the camera and face it before recording this punch.");
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (page) element("camera").srcObject = null;
}
async function capture(direction) {
  if (capturing || !profile) return;
  capturing = true;
  await render();
  try {
    await locked(`capture:${owner(profile)}`, async () => {
      const capturedAt = new Date(
        Date.now() + (profile.offset || 0),
      ).toISOString();
      if (Date.parse(capturedAt) > Date.parse(profile.expiresAt))
        throw new Error(
          "Offline access has expired. Connect and refresh it before recording a new punch.",
        );
      const events = await rows(),
        pending = events.filter((e) => e.status !== "SYNCED");
      if (pending.length >= 200)
        throw new Error(
          "This device has 200 pending punches. Sync them before adding more.",
        );
      const last = pending.at(-1),
        checkedIn = last ? last.direction === "IN" : !!profile.checkedIn;
      if (
        (direction === "IN" && checkedIn) ||
        (direction === "OUT" && !checkedIn)
      )
        throw new Error(
          "Attendance state changed in another tab. Review pending punches and retry.",
        );
      const faceSample = face(),
        loc = await location(),
        id = crypto.randomUUID();
      const payload = {
        deviceId: profile.deviceId,
        ...(loc ? { location: loc } : {}),
        ...(faceSample ? { faceSample } : {}),
        offline: { eventId: id, direction, capturedAt, permit: profile.permit },
      };
      const event = {
        id,
        owner: owner(profile),
        direction,
        capturedAt,
        status: "PENDING",
        endpoint: profile.faceRequired
          ? "face-punch"
          : direction === "IN"
            ? "check-in"
            : "check-out",
        payload: await seal(payload),
      };
      await write("events", event);
      stopCamera();
      message(
        `${direction === "IN" ? "Check-in" : "Check-out"} saved on this device. ${navigator.onLine ? "Syncing now…" : "It will sync when a connection is available."}`,
      );
    });
  } catch (error) {
    message(error.message, true);
  } finally {
    capturing = false;
    await render();
    void sync();
  }
}
async function sync() {
  if (syncing || capturing || !profile || !navigator.onLine) return;
  syncing = true;
  try {
    await locked(`sync:${owner(profile)}`, async () => {
      const events = (await rows()).filter((e) => e.status !== "SYNCED");
      if (!events.length) return;
      const me = await request("auth/me");
      if (owner(me) !== owner(profile))
        throw new Error(
          "Sign in as the prepared employee to sync. Records cannot be sent to a different employee account.",
        );
      for (const event of events) {
        try {
          const payload = await unseal(event.payload);
          const saved = await request(`time/${event.endpoint}`, payload);
          // Remove the encrypted face/location payload only after the server
          // acknowledges this stable event ID. Retries cannot create duplicates.
          await write("events", {
            ...event,
            status: "SYNCED",
            error: null,
            payload: null,
          });
          profile.checkedIn = !saved.checkOut;
          profile.lastPunch = saved.checkOut || saved.checkIn;
          await write("profiles", {
            owner: owner(profile),
            ...(await seal(profile)),
          });
          message("Saved punches synced successfully.");
        } catch (error) {
          await write("events", { ...event, error: error.message });
          message(error.message, true);
          break; // Preserve chronological order, including failed check-ins.
        }
      }
    });
  } catch (error) {
    message(error.message, true);
  } finally {
    syncing = false;
    await render();
  }
}
async function start() {
  try {
    database = await openDatabase();
    const active = await read("meta", "active"),
      saved = active ? await read("profiles", active) : null;
    if (saved) profile = await unseal(saved);
    if (page) {
      element("clock-in").onclick = () => void capture("IN");
      element("clock-out").onclick = () => void capture("OUT");
      element("sync").onclick = () => void sync();
      element("prepare").onclick = () =>
        void prepare()
          .then(sync)
          .catch((e) => message(e.message, true));
      element("camera-open").onclick = async () => {
        try {
          stopCamera();
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 480 },
              height: { ideal: 360 },
            },
            audio: false,
          });
          element("camera").srcObject = stream;
          await element("camera").play();
          message(
            "Camera ready. Choose Check in or Check out to capture and save.",
          );
        } catch {
          message(
            "Allow camera access to capture your face. HTTPS is required.",
            true,
          );
        }
      };
      await render();
    }
    if (navigator.onLine)
      await prepare()
        .then(sync)
        .catch((error) => message(error.message, true));
    window.addEventListener("online", () => {
      void render();
      void sync();
    });
    window.addEventListener("offline", () => void render());
    window.addEventListener("pagehide", stopCamera);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void sync();
      else stopCamera();
    });
    setInterval(() => {
      if (document.visibilityState === "visible") void sync();
    }, 30000);
  } catch (error) {
    message(error.message, true);
  }
}
void start();
