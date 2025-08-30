// public/script.js
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleAdd');
  const form = document.getElementById('addForm');
  const bucketCustom = document.getElementById('bucket_custom');

  // ---- Guard: this script also loads on /login & /register where these don't exist
  if (!toggleBtn || !form) return;

  // ---- Collapse initially
  form.classList.remove('open');
  form.style.maxHeight = '0px';

  // ---- Helpers to animate slide
  const openPanel = (el) => {
    el.classList.add('open');
    // Allow DOM to apply 'open' class before measuring
    requestAnimationFrame(() => {
      el.style.maxHeight = el.scrollHeight + 'px';
    });
  };

  const closePanel = (el) => {
    el.style.maxHeight = '0px';
    el.classList.remove('open');
  };

  // ---- Toggle on click
  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (form.classList.contains('open')) closePanel(form);
    else openPanel(form);
  });

  // ---- When submitting, if user typed a new bucket, add it to the <select>
  form.addEventListener('submit', () => {
    if (!bucketCustom) return;
    const custom = bucketCustom.value.trim();
    if (!custom) return;

    const sel = form.querySelector('select[name="bucket"]');
    if (!sel) return;

    const opt = document.createElement('option');
    opt.value = custom;
    opt.textContent = custom;
    sel.appendChild(opt);
    sel.value = custom;
  });

  // ---- Keep height correct if window resizes while panel is open
  window.addEventListener('resize', () => {
    if (form.classList.contains('open')) {
      form.style.maxHeight = form.scrollHeight + 'px';
    }
  });

  // ---- Toggle "done" checkboxes via AJAX (works for items on the page)
  document.querySelectorAll('.toggle').forEach((cb) => {
    cb.addEventListener('change', async (e) => {
      const id = e.target.dataset.id;
      const is_done = e.target.checked ? 1 : 0;
      try {
        await fetch(`/tasks/${id}/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_done }),
        });
        const card = e.target.closest('.card');
        if (card) {
          if (is_done) card.classList.add('done');
          else card.classList.remove('done');
        }
      } catch (err) {
        console.error('Toggle failed', err);
      }
    });
  });
});
