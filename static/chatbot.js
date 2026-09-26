
document.addEventListener('DOMContentLoaded', () => {
  const panel = document.getElementById('sentinelChatPanel');
  const toggle = document.getElementById('sentinelChatToggle');
  const close = document.getElementById('sentinelChatClose');
  const form = document.getElementById('sentinelChatForm');
  const input = document.getElementById('sentinelChatInput');
  const messages = document.getElementById('sentinelChatMessages');
  const quick = document.querySelectorAll('[data-chat-message]');
  const csrf = document.getElementById('chatbotCsrfToken')?.value;

  if (!panel || !toggle || !form || !input || !messages) return;

  const addMessage = (text, role='bot', prediction=null, showReport=false) => {
    const wrap = document.createElement('div');
    wrap.className = `sentinel-chat-msg ${role}`;
    wrap.textContent = text;
    if (prediction) {
      const p = document.createElement('div');
      p.className = 'sentinel-chat-prediction';
      p.textContent = `ML: ${prediction.label} • ${Number(prediction.confidence_percent).toFixed(2)}% confidence`;
      wrap.appendChild(p);
    }
    if (showReport) {
      const a = document.createElement('a');
      a.className = 'sentinel-chat-report';
      a.href = '/report/';
      const label = document.createElement('span');
      label.textContent = 'OPEN INCIDENT REPORT';
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined mi-18';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = 'arrow_forward';
      a.appendChild(label);
      a.appendChild(icon);
      wrap.appendChild(a);
    }
    messages.appendChild(wrap);
    messages.scrollTop = messages.scrollHeight;
  };

  const sendMessage = async (value) => {
    const message = (value || input.value || '').trim();
    if (!message) return;
    input.value = '';
    addMessage(message, 'user');

    const typing = document.createElement('div');
    typing.className = 'sentinel-chat-msg bot sentinel-chat-typing';
    typing.textContent = 'Sentinel Assistant is analyzing...';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;

    try {
      const response = await fetch('/api/chatbot/', {
        method: 'POST',
        headers: {'Content-Type':'application/json', 'X-CSRFToken': csrf || ''},
        credentials: 'same-origin',
        body: JSON.stringify({message})
      });
      const data = await response.json();
      typing.remove();
      if (!response.ok || !data.success) throw new Error(data.error || 'Chatbot request failed.');
      addMessage(data.reply, 'bot', data.prediction, data.show_report);
    } catch (error) {
      typing.remove();
      addMessage('Unable to connect to the Sentinel Assistant right now. Please use the Incident Report page directly.', 'bot', null, true);
    }
  };

  toggle.addEventListener('click', () => panel.classList.toggle('open'));
  close?.addEventListener('click', () => panel.classList.remove('open'));
  form.addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  quick.forEach(btn => btn.addEventListener('click', () => sendMessage(btn.dataset.chatMessage)));
});
