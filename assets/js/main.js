/**
 * main.js — funções globais do site (carregado em todas as páginas).
 * - Toggle do menu mobile
 * - Init do cart drawer (carrega cart.js)
 * - Helpers de formatação
 */

(function () {
  'use strict';

  // ─── Menu mobile (hamburger) ───
  const toggle = document.querySelector('.nav-toggle');
  const menu = document.querySelector('.nav-menu');
  if (toggle && menu) {
    toggle.addEventListener('click', () => {
      menu.classList.toggle('open');
    });
  }

  // ─── Formatadores globais ───
  window.formatBRL = function (n) {
    if (n == null || isNaN(n)) return null;
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  window.formatBRLfull = function (n) {
    const v = window.formatBRL(n);
    return v ? `R$ ${v}` : '';
  };

  // ─── Smooth scroll para âncoras internas ───
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const href = a.getAttribute('href');
      if (href.length > 1) {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });
})();
