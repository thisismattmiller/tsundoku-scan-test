/**
 * tsundoku-scan client library
 *
 * Computer side: connects to WebSocket, generates QR code, receives results.
 * Mobile side: scans QR code, captures photos, sends them for processing.
 */

class TsundokuScan {
  constructor(opts = {}) {
    this.wsUrl = opts.wsUrl;
    this.ws = null;
    this.connectionId = null;
    this.endpoint = null;
    this.onSession = opts.onSession || null;
    this.onResult = opts.onResult || null;
    this.onError = opts.onError || null;
    this.onClose = opts.onClose || null;
  }

  /** Connect to the WebSocket and request a session. */
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.ws.send(JSON.stringify({ action: "init" }));
      };

      this.ws.onmessage = (evt) => {
        let data;
        try {
          data = JSON.parse(evt.data);
        } catch {
          return;
        }

        if (data.action === "session") {
          this.connectionId = data.connectionId;
          this.endpoint = data.endpoint;
          if (this.onSession) this.onSession(data);
          resolve(data);
        } else if (data.action === "result") {
          if (this.onResult) this.onResult(data);
        } else if (data.action === "error") {
          if (this.onError) this.onError(data);
        }
      };

      this.ws.onerror = (err) => {
        if (this.onError) this.onError(err);
        reject(err);
      };

      this.ws.onclose = (evt) => {
        if (this.onClose) this.onClose(evt);
      };
    });
  }

  /** Disconnect the WebSocket. */
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Build the data object for the QR code.
   * Contains everything the mobile page needs to pair.
   */
  getQRData(processUrl) {
    return JSON.stringify({
      connectionId: this.connectionId,
      endpoint: this.endpoint,
      processUrl: processUrl,
    });
  }

  /**
   * Render a styled QR code into a container element.
   * Requires qr-code-styling to be loaded.
   * @param {HTMLElement} container - DOM element to append QR code to
   * @param {string} processUrl - URL of the processing Lambda
   * @param {object} opts - optional overrides for QRCodeStyling
   * @returns {QRCodeStyling} the QR code instance
   */
  renderQR(container, processUrl, opts = {}) {
    if (typeof QRCodeStyling === "undefined") {
      throw new Error("qr-code-styling library is not loaded");
    }
    const data = this.getQRData(processUrl);
    const qr = new QRCodeStyling({
      width: opts.width || 280,
      height: opts.height || 280,
      data: data,
      type: "svg",
      dotsOptions: {
        type: opts.dotType || "rounded",
        color: opts.dotColor || "#1a1a2e",
      },
      cornersSquareOptions: {
        type: "extra-rounded",
        color: opts.cornerColor || "#16213e",
      },
      backgroundOptions: {
        color: opts.bgColor || "#ffffff",
      },
      ...opts,
    });
    container.innerHTML = "";
    qr.append(container);
    return qr;
  }
}

/**
 * Mobile-side: camera and photo capture using native APIs.
 */
class TsundokuCamera {
  constructor(videoElement) {
    this.video = videoElement;
    this.stream = null;
  }

  /** Start the rear camera. */
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute("playsinline", true);
    await this.video.play();
  }

  /** Capture a photo as a JPEG data URL. */
  capture(quality = 0.85) {
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    canvas.getContext("2d").drawImage(this.video, 0, 0);
    return canvas.toDataURL("image/jpeg", quality);
  }

  /** Capture as a Blob for uploading. */
  async captureBlob(quality = 0.85) {
    const canvas = document.createElement("canvas");
    canvas.width = this.video.videoWidth;
    canvas.height = this.video.videoHeight;
    canvas.getContext("2d").drawImage(this.video, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", quality);
    });
  }

  /** Stop the camera. */
  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }
}

/**
 * Mobile-side: send a captured photo to the processing endpoint.
 */
async function sendPhoto(processUrl, connectionId, imageDataUrl, category) {
  const resp = await fetch(processUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      connectionId: connectionId,
      image: imageDataUrl,
      category: category,
    }),
  });
  return resp.json();
}
