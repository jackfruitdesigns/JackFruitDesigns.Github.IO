// Nav shadow on scroll
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// Mobile hamburger menu
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');

hamburger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
});

// Close mobile menu when a link is tapped
mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        hamburger.setAttribute('aria-label', 'Open menu');
    });
});

// Scroll-reveal — fades sections in as they enter the viewport
const revealObserver = new IntersectionObserver(
    (entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    },
    { threshold: 0.12 }
);

document.querySelectorAll('.service-card, .about__text, .section-header')
    .forEach(el => {
        el.classList.add('reveal');
        revealObserver.observe(el);
    });

// ── Contact form → Formspree ──────────────────────────────
// TO ACTIVATE:
//   1. Go to https://formspree.io and sign up with jackfruitdesignstudio@gmail.com
//   2. Click "New Form", name it anything (e.g. "Jackfruit Designs")
//   3. Copy the form ID from the endpoint they give you (the part after /f/)
//   4. Paste it into FORMSPREE_ID below and save
const FORMSPREE_ID = 'mvzyngjw';

const form = document.getElementById('contactForm');
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.textContent = 'Sending…';
    btn.disabled = true;

    try {
        const res = await fetch(`https://formspree.io/f/${FORMSPREE_ID}`, {
            method: 'POST',
            body: new FormData(form),
            headers: { 'Accept': 'application/json' },
        });

        if (res.ok) {
            btn.textContent = 'Message Sent!';
            btn.style.background = 'var(--green-mid)';
            form.reset();
        } else {
            btn.textContent = 'Something went wrong — try again';
            btn.style.background = '#c0392b';
        }
    } catch {
        btn.textContent = 'No connection — try again';
        btn.style.background = '#c0392b';
    }

    setTimeout(() => {
        btn.textContent = original;
        btn.style.background = '';
        btn.disabled = false;
    }, 4000);
});
