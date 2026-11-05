document.getElementById('scanBtn').addEventListener('click', scanAndOpen);
document.getElementById('blankBtn').addEventListener('click', openEditorBlank);

function setStatus(msg, type) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (type ? ' ' + type : '');
}

function openEditorBlank() {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
  window.close();
}

function scanAndOpen() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true;
  setStatus('Checking current tab…', 'scanning');

  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (!tabs || !tabs[0]) {
      setStatus('Could not access the current tab.', 'error');
      btn.disabled = false;
      return;
    }

    const tab = tabs[0];
    const url = tab.url || '';

    // Allow scan on sign_up and complete_signup pages
    if (!url.includes('sign_up') && !url.includes('complete_signup')) {
      setStatus('Navigate to a Thinkific sign_up page first.', 'warn');
      btn.disabled = false;
      return;
    }

    setStatus('Scanning fields…', 'scanning');

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: function() {
        var results = [];
        var seen = new Set();
        document.querySelectorAll('input, select, textarea').forEach(function(el) {
          var name = el.getAttribute('name') || '';
          var m = name.match(/custom_profile_fields_attributes\]\[(\d+)\]\[value\]/);
          if (!m) return;
          var idx = parseInt(m[1]);
          if (seen.has(idx)) return;
          seen.add(idx);
          var label = '';
          var group = el.closest('.form__group') || el.closest('.field') || el.parentElement;
          if (group) {
            var lbl = group.querySelector('label');
            if (lbl) label = lbl.textContent.trim().replace(/\s+/g, ' ');
          }
          if (!label) label = el.getAttribute('placeholder') || '';
          results.push({ idx: idx, label: label });
        });
        results.sort(function(a, b) { return a.idx - b.idx; });
        return results;
      }
    }, function(results) {
      if (chrome.runtime.lastError) {
        setStatus('Scan failed: ' + chrome.runtime.lastError.message, 'error');
        btn.disabled = false;
        return;
      }

      const found = (results && results[0] && results[0].result) ? results[0].result : [];

      if (!found || found.length === 0) {
        setStatus('No custom fields found on this page.', 'warn');
        btn.disabled = false;
        return;
      }

      // Store scan results so the editor page can pick them up
      chrome.storage.session.set({ scanResult: found }, function() {
        setStatus('Found ' + found.length + ' field(s). Opening editor…', 'scanning');
        chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
        window.close();
      });
    });
  });
}
