/* M38 CODE GIFTZ acceptance fixture — behavior layer.
   Every control works: mobile menu toggles, nav anchors scroll, the form
   validates + confirms + clears, stat counters animate on reveal.
   Animations are transform/opacity only; prefers-reduced-motion is honored
   by skipping reveals and counters (final values render immediately). */
(function () {
  'use strict'

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---- scroll reveal (IntersectionObserver, one observer, unobserved after reveal)
  var reveals = document.querySelectorAll('.reveal')
  if (reducedMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-visible') })
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          io.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' })
    reveals.forEach(function (el) { io.observe(el) })
  }

  // ---- mobile menu (real toggle, aria-expanded kept in sync)
  var toggle = document.querySelector('.menu-toggle')
  var mobileNav = document.getElementById('mobile-nav')
  if (toggle && mobileNav) {
    toggle.addEventListener('click', function () {
      var open = mobileNav.hidden
      mobileNav.hidden = !open
      toggle.setAttribute('aria-expanded', String(open))
      toggle.textContent = open ? 'Close' : 'Menu'
    })
    mobileNav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        mobileNav.hidden = true
        toggle.setAttribute('aria-expanded', 'false')
        toggle.textContent = 'Menu'
      }
    })
  }

  // ---- animated stat counters (on first reveal; skipped under reduced motion)
  function animateCount(el) {
    var target = parseInt(el.getAttribute('data-count') || '0', 10)
    var suffix = el.getAttribute('data-suffix') || ''
    if (reducedMotion) { el.textContent = target + suffix; return }
    var start = null
    var dur = 700
    function step(ts) {
      if (start === null) start = ts
      var p = Math.min((ts - start) / dur, 1)
      var eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
      el.textContent = Math.round(target * eased) + suffix
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  var counters = document.querySelectorAll('.stat-num')
  if ('IntersectionObserver' in window && !reducedMotion) {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animateCount(entry.target)
          cio.unobserve(entry.target)
        }
      })
    }, { threshold: 0.6 })
    counters.forEach(function (el) { cio.observe(el) })
  } else {
    counters.forEach(function (el) {
      el.textContent = el.getAttribute('data-count') + (el.getAttribute('data-suffix') || '')
    })
  }

  // ---- enquiry form: validate → confirm → clear (no fake backend claims)
  var form = document.getElementById('enquiry')
  var status = form.querySelector('.form-status')
  function setErr(id, show) {
    var input = document.getElementById(id)
    var err = form.querySelector('[data-err-for="' + id + '"]')
    if (input) input.closest('.field').classList.toggle('invalid', show)
    if (err) err.hidden = !show
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault()
    var name = document.getElementById('name')
    var email = document.getElementById('email')
    var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())
    var nameOk = name.value.trim().length > 0
    setErr('name', !nameOk)
    setErr('email', !emailOk)
    if (!nameOk) { name.focus(); return }
    if (!emailOk) { email.focus(); return }
    var party = document.getElementById('party')
    status.textContent = 'Thanks, ' + name.value.trim() + ' — demo form received for a party of ' +
      party.value + '. Nothing was stored: this is an acceptance fixture.'
    form.reset()
    setErr('name', false)
    setErr('email', false)
  })
})()
