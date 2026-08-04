/* Finance Desk — client-side encryption vault.
 *
 * Encrypts the app's data at rest in localStorage behind a PIN, using the Web
 * Crypto API: a 256-bit AES-GCM key is derived from the PIN with PBKDF2
 * (SHA-256, 210k iterations) and a random salt. The key lives only in memory
 * while unlocked; only the salt, IV, and ciphertext are stored.
 *
 * Honest scope: this protects data AT REST on the device. It is not a
 * server-enforced login, and it cannot protect against malware running in your
 * browser. Losing the PIN means the local data cannot be recovered — keep a
 * JSON backup.
 */
(function (root) {
  "use strict";

  var FLAG_KEY = "financedesk.vault.enabled";
  var BLOB_KEY = "financedesk.vault.blob";
  var ITERATIONS = 210000;

  var subtle = (root.crypto && root.crypto.subtle) ? root.crypto.subtle : null;

  var mem = { key: null, salt: null, active: false };

  // ---- base64 <-> bytes ----
  function bufToB64(buf) {
    var bytes = new Uint8Array(buf), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return root.btoa(bin);
  }
  function b64ToBytes(b64) {
    var bin = root.atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  function randBytes(n) { var a = new Uint8Array(n); root.crypto.getRandomValues(a); return a; }

  function deriveKey(pin, saltBytes) {
    return subtle.importKey("raw", new TextEncoder().encode(String(pin)), { name: "PBKDF2" }, false, ["deriveKey"])
      .then(function (baseKey) {
        return subtle.deriveKey(
          { name: "PBKDF2", salt: saltBytes, iterations: ITERATIONS, hash: "SHA-256" },
          baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }

  function encryptWith(key, saltBytes, obj) {
    var iv = randBytes(12);
    var data = new TextEncoder().encode(JSON.stringify(obj));
    return subtle.encrypt({ name: "AES-GCM", iv: iv }, key, data).then(function (ct) {
      return { v: 1, salt: bufToB64(saltBytes), iv: bufToB64(iv), ct: bufToB64(ct) };
    });
  }
  function decryptWith(key, blob) {
    return subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(blob.iv) }, key, b64ToBytes(blob.ct))
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); });
  }

  function readBlob() {
    try { var raw = root.localStorage.getItem(BLOB_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function writeBlob(blob) { root.localStorage.setItem(BLOB_KEY, JSON.stringify(blob)); }

  var Vault = {
    supported: function () { return !!subtle; },
    isEnabled: function () { try { return root.localStorage.getItem(FLAG_KEY) === "1"; } catch (e) { return false; } },
    isActive: function () { return mem.active && !!mem.key; },

    // Turn on encryption: encrypt the current state, drop the plaintext keys.
    enable: function (pin, stateObj) {
      var salt = randBytes(16), keyRef;
      return deriveKey(pin, salt).then(function (key) {
        keyRef = key; return encryptWith(key, salt, stateObj);
      }).then(function (blob) {
        writeBlob(blob);
        root.localStorage.setItem(FLAG_KEY, "1");
        // Remove plaintext copies now that an encrypted blob exists.
        ["financedesk.accounts", "financedesk.journal", "financedesk.budgets"].forEach(function (k) {
          try { root.localStorage.removeItem(k); } catch (e) {}
        });
        mem.key = keyRef; mem.salt = salt; mem.active = true;
        return true;
      });
    },

    // Unlock with a PIN. Resolves with the decrypted state or rejects on wrong PIN.
    unlock: function (pin) {
      var blob = readBlob();
      if (!blob) return Promise.reject(new Error("No vault found."));
      var saltBytes = b64ToBytes(blob.salt), keyRef;
      return deriveKey(pin, saltBytes).then(function (key) {
        keyRef = key; return decryptWith(key, blob);
      }).then(function (data) {
        mem.key = keyRef; mem.salt = saltBytes; mem.active = true;
        return data;
      }).catch(function () { return Promise.reject(new Error("Incorrect PIN.")); });
    },

    // Persist new state while unlocked (re-encrypts with the same salt).
    save: function (stateObj) {
      if (!this.isActive()) return Promise.resolve(false);
      return encryptWith(mem.key, mem.salt, stateObj).then(function (blob) { writeBlob(blob); return true; });
    },

    // Change the PIN (fresh salt), keeping the same data.
    changePin: function (newPin, stateObj) {
      var salt = randBytes(16), keyRef;
      return deriveKey(newPin, salt).then(function (key) {
        keyRef = key; return encryptWith(key, salt, stateObj);
      }).then(function (blob) {
        writeBlob(blob); mem.key = keyRef; mem.salt = salt; mem.active = true; return true;
      });
    },

    // Turn off encryption. Caller should persist plaintext afterwards.
    disable: function () {
      try { root.localStorage.removeItem(BLOB_KEY); root.localStorage.removeItem(FLAG_KEY); } catch (e) {}
      mem.key = null; mem.salt = null; mem.active = false;
      return Promise.resolve(true);
    },

    // Lock in place (data stays encrypted; requires unlock to read again).
    lock: function () { mem.key = null; mem.salt = null; mem.active = false; },

    // ---- Passphrase-based encryption (used for end-to-end encrypted sync) ----
    // Independent of the PIN vault: derive a key from an arbitrary passphrase and
    // a fresh random salt, and return a self-contained envelope {v,salt,iv,ct}.
    encryptData: function (passphrase, obj) {
      var salt = randBytes(16);
      return deriveKey(passphrase, salt).then(function (key) { return encryptWith(key, salt, obj); });
    },
    // Decrypt an envelope produced by encryptData, given the same passphrase.
    decryptData: function (passphrase, envelope) {
      var saltBytes = b64ToBytes(envelope.salt);
      return deriveKey(passphrase, saltBytes).then(function (key) { return decryptWith(key, envelope); });
    },
  };

  root.FDVault = Vault;
  if (typeof module !== "undefined" && module.exports) module.exports = Vault;
})(typeof window !== "undefined" ? window : globalThis);
