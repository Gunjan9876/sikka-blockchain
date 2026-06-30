// ===== Utility Functions =====
function debounce(func, wait = 10) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ===== Scroll Progress Indicator =====
const scrollProgress = document.getElementById('scroll-progress');

function updateScrollProgress() {
    const scrollTop = window.pageYOffset;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = (scrollTop / docHeight) * 100;
    if (scrollProgress) {
        scrollProgress.style.width = `${Math.min(progress, 100)}%`;
    }
}

window.addEventListener('scroll', updateScrollProgress, { passive: true });

// ===== Navigation Scroll Effect =====
const navbar = document.getElementById('mainNav');
let lastScroll = 0;

function handleNavScroll() {
    const currentScroll = window.pageYOffset;

    if (currentScroll > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
}

window.addEventListener('scroll', debounce(handleNavScroll, 5), { passive: true });
handleNavScroll();

// ===== Smooth Scroll =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href === '#') return;

        e.preventDefault();
        const target = document.querySelector(href);

        if (target) {
            const navHeight = navbar.offsetHeight;
            const targetPosition = target.offsetTop - navHeight - 20;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });

            // Close mobile menu
            const collapse = document.querySelector('.navbar-collapse');
            if (collapse?.classList.contains('show')) {
                bootstrap.Collapse.getOrCreateInstance(collapse).hide();
            }
        }
    });
});

// ===== Active Navigation Link =====
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link');

function updateActiveNav() {
    const scrollPos = window.pageYOffset + navbar.offsetHeight + 100;

    sections.forEach(section => {
        const top = section.offsetTop;
        const height = section.offsetHeight;
        const id = section.getAttribute('id');

        if (scrollPos >= top && scrollPos < top + height) {
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === `#${id}`) {
                    link.classList.add('active');
                }
            });
        }
    });
}

window.addEventListener('scroll', debounce(updateActiveNav, 10), { passive: true });

// ===== Intersection Observer for Animations =====
const observerOptions = {
    root: null,
    rootMargin: '0px 0px -50px 0px',
    threshold: 0.15
};

const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            fadeObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.fade-up, .fade-left, .fade-right').forEach(el => {
    fadeObserver.observe(el);
});

// ===== Particle System =====
function createParticles() {
    const container = document.getElementById('particles');
    if (!container) return;

    const particleCount = 50;

    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';

        const size = Math.random() * 3 + 2;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;

        particle.style.left = `${Math.random() * 100}%`;
        particle.style.top = `${Math.random() * 100}%`;

        particle.style.animationDelay = `${Math.random() * 10}s`;
        particle.style.animationDuration = `${10 + Math.random() * 10}s`;

        container.appendChild(particle);
    }
}

createParticles();

// ===== Blockchain Connection Lines =====
function initBlockchainNetwork() {
    const svg = document.getElementById('connection-lines');
    const network = document.getElementById('blockchain-network');
    if (!svg || !network) return;

    const nodes = network.querySelectorAll('.blockchain-node');

    // Clear existing lines
    svg.innerHTML = '';

    // Create connections from each node to the center
    nodes.forEach(node => {
        const nodeRect = node.getBoundingClientRect();
        const networkRect = network.getBoundingClientRect();

        const nodeCenterX = nodeRect.left - networkRect.left + nodeRect.width / 2;
        const nodeCenterY = nodeRect.top - networkRect.top + nodeRect.height / 2;

        const centerX = networkRect.width / 2;
        const centerY = networkRect.height / 2;

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', nodeCenterX);
        line.setAttribute('y1', nodeCenterY);
        line.setAttribute('x2', centerX);
        line.setAttribute('y2', centerY);

        svg.appendChild(line);
    });
}

// Initialize on load and resize
window.addEventListener('load', initBlockchainNetwork);
window.addEventListener('resize', debounce(initBlockchainNetwork, 100));

// ===== Magnetic Button Effect =====
const magneticBtns = document.querySelectorAll('.magnetic-btn');

magneticBtns.forEach(btn => {
    let boundingRect = btn.getBoundingClientRect();
    let isHovering = false;

    btn.addEventListener('mouseenter', () => {
        boundingRect = btn.getBoundingClientRect();
        isHovering = true;
    });

    btn.addEventListener('mouseleave', () => {
        isHovering = false;
        btn.style.transform = '';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isHovering) return;

        const x = e.clientX - boundingRect.left - boundingRect.width / 2;
        const y = e.clientY - boundingRect.top - boundingRect.height / 2;

        const strength = 0.25;
        const maxDistance = 20;

        const moveX = Math.min(Math.max(x * strength, -maxDistance), maxDistance);
        const moveY = Math.min(Math.max(y * strength, -maxDistance), maxDistance);

        btn.style.transform = `translate(${moveX}px, ${moveY}px)`;
    });
});

// ===== Timeline Scroll Animation =====
const timeline = document.querySelector('.timeline');
const timelineItems = document.querySelectorAll('.timeline-item');
const timelineProgress = document.getElementById('timeline-progress');

function updateTimeline() {
    if (!timeline || !timelineProgress) return;

    const timelineRect = timeline.getBoundingClientRect();
    const viewportHeight = window.innerHeight;

    // Calculate progress
    const totalScrollDistance = timelineRect.height;
    const scrolled = viewportHeight - timelineRect.top;

    let progress = scrolled / totalScrollDistance;
    progress = Math.max(0, Math.min(progress, 1));

    timelineProgress.style.height = `${progress * 100}%`;

    // Activate timeline items
    timelineItems.forEach((item, index) => {
        const itemRect = item.getBoundingClientRect();
        const itemCenter = itemRect.top + itemRect.height / 2;

        if (itemCenter < viewportHeight * 0.7) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });
}

window.addEventListener('scroll', debounce(updateTimeline, 5), { passive: true });

// ===== Ripple Effect on Buttons =====
document.querySelectorAll('.btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const ripple = document.createElement('span');
        ripple.className = 'ripple-effect';
        ripple.style.left = `${x}px`;
        ripple.style.top = `${y}px`;
        ripple.style.width = ripple.style.height = `${Math.max(rect.width, rect.height) * 2}px`;

        this.style.position = 'relative';
        this.style.overflow = 'hidden';
        this.appendChild(ripple);

        setTimeout(() => ripple.remove(), 600);
    });
});

// ===== Parallax Effect =====
let ticking = false;

function updateParallax() {
    const scrolled = window.pageYOffset;

    // Hero background parallax
    const heroBg = document.querySelector('.hero-bg');
    if (heroBg) {
        const heroSection = document.querySelector('.hero-section');
        if (scrolled < heroSection.offsetHeight) {
            heroBg.style.transform = `translateY(${scrolled * 0.3}px)`;
        }
    }

    // Floating cards parallax
    const floatingCards = document.querySelectorAll('.floating-card');
    floatingCards.forEach((card, i) => {
        const speed = 0.02 + (i * 0.01);
        card.style.transform = `translateY(${scrolled * speed}px)`;
    });

    ticking = false;
}

window.addEventListener('scroll', () => {
    if (!ticking) {
        requestAnimationFrame(updateParallax);
        ticking = true;
    }
}, { passive: true });

// ===== Tech Card Icon Rotation on Hover =====
const techCards = document.querySelectorAll('.tech-card');

techCards.forEach(card => {
    const icon = card.querySelector('.tech-icon');

    card.addEventListener('mouseenter', () => {
        if (icon) {
            icon.style.transform = 'rotate(10deg) scale(1.1)';
        }
    });

    card.addEventListener('mouseleave', () => {
        if (icon) {
            icon.style.transform = '';
        }
    });
});

// ===== Floating Animation Enhancement for About Cards =====
const aboutCards = document.querySelectorAll('.floating-card');

aboutCards.forEach(card => {
    card.addEventListener('mouseenter', () => {
        aboutCards.forEach(c => {
            if (c !== card) {
                c.style.opacity = '0.5';
                c.style.transform = 'scale(0.98)';
            }
        });
    });

    card.addEventListener('mouseleave', () => {
        aboutCards.forEach(c => {
            c.style.opacity = '1';
            c.style.transform = '';
        });
    });
});

// ===== Preloader Animation =====
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
    updateScrollProgress();
    updateActiveNav();

    // Trigger initial animations
    setTimeout(() => {
        document.querySelectorAll('.fade-up, .fade-left, .fade-right').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight) {
                el.classList.add('visible');
            }
        });
    }, 100);
});

// ===== Handle Resize for Responsive Animations =====
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        initBlockchainNetwork();
    }, 250);
});

// ===== Initialize =====
console.log('SIKKA Landing Page Initialized');
