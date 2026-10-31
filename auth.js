/* ============================================================
   BC Floors – yhteinen kirjautuminen (Firebase Auth)
   Käyttö sivulla:
     1) lataa firebase-auth(-compat).js samaa versiota kuin firebase-app
     2) lataa tämä tiedosto: <script src="auth.js"></script>
     3) kun firebase.initializeApp on tehty, kääri Firestore-/Storage-
        haut: bcKirjaudu(function(user) { ... });
   Kirjautuminen säilyy selaimessa (Firebasen oletus), joten se
   kysytään kerran per selain ja osoite.
   Ei käytössä mitta-view.html:ssä (asiakkaan sivu on avoin).
   ============================================================ */
(function () {
  var odottavat = [];
  var kayttaja = null;
  var kaynnistetty = false;
  var overlay = null;
  var ulosNappi = null;

  var CSS =
    '.bca-overlay{position:fixed;inset:0;z-index:2147483000;background:#006CB1;display:flex;align-items:center;justify-content:center;padding:20px;font-family:"Spartan","Segoe UI",system-ui,-apple-system,sans-serif}' +
    '.bca-kortti{background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);width:100%;max-width:360px;padding:28px 24px 24px;color:#1a2530}' +
    '.bca-otsikko{font-size:20px;font-weight:700;margin:0 0 4px}' +
    '.bca-ali{font-size:13px;color:#64748b;margin:0 0 20px}' +
    '.bca-kortti label{display:block;font-size:12px;font-weight:600;margin:0 0 4px;color:#1a2530}' +
    '.bca-kortti input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;margin:0 0 14px;outline:none;color:#1a2530;background:#fff}' +
    '.bca-kortti input:focus{border-color:#006CB1}' +
    '.bca-nappi{display:block;width:100%;font:inherit;font-size:15px;font-weight:700;padding:12px;border:none;border-radius:10px;background:#e8a020;color:#fff;cursor:pointer}' +
    '.bca-nappi:disabled{opacity:.6;cursor:default}' +
    '.bca-virhe{min-height:18px;font-size:13px;color:#dc2626;margin:10px 0 0}' +
    '.bca-ulos{position:fixed;left:8px;bottom:8px;z-index:2147482000;font-family:"Spartan","Segoe UI",system-ui,sans-serif;font-size:11px;padding:5px 9px;border-radius:8px;border:1px solid #e2e8f0;background:rgba(255,255,255,.92);color:#64748b;cursor:pointer}' +
    '.bca-ulos:hover{color:#dc2626;border-color:#fca5a5}' +
    '.bca-ulos.bca-upotettu{position:static;font-size:11px;font-weight:600;padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;white-space:nowrap}' +
    '.bca-ulos.bca-upotettu:hover{background:rgba(255,255,255,.25);color:#fff;border-color:rgba(255,255,255,.6)}' +
    '@media print{.bca-overlay,.bca-ulos{display:none!important}}';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function kunDomValmis(fn) {
    if (document.body) fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  function lisaaTyylit() {
    if (document.getElementById('bca-tyylit')) return;
    var st = document.createElement('style');
    st.id = 'bca-tyylit';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function virheTeksti(e) {
    var k = (e && e.code) || '';
    if (k === 'auth/wrong-password' || k === 'auth/user-not-found' ||
        k === 'auth/invalid-credential' || k === 'auth/invalid-login-credentials')
      return 'Väärä sähköposti tai salasana.';
    if (k === 'auth/invalid-email') return 'Sähköpostiosoite ei kelpaa.';
    if (k === 'auth/too-many-requests') return 'Liian monta yritystä. Odota hetki ja yritä uudelleen.';
    if (k === 'auth/network-request-failed') return 'Ei verkkoyhteyttä.';
    if (k === 'auth/user-disabled') return 'Käyttäjätunnus on poistettu käytöstä.';
    return 'Kirjautuminen epäonnistui: ' + ((e && e.message) || k);
  }

  function naytaKirjautuminen() {
    kunDomValmis(function () {
      lisaaTyylit();
      if (overlay) { overlay.style.display = 'flex'; return; }
      overlay = document.createElement('div');
      overlay.className = 'bca-overlay';
      overlay.innerHTML =
        '<form class="bca-kortti" novalidate>' +
          '<p class="bca-otsikko">BC Floors</p>' +
          '<p class="bca-ali">Kirjaudu sisään jatkaaksesi.</p>' +
          '<label for="bca-email">Sähköposti</label>' +
          '<input id="bca-email" type="email" autocomplete="username" required>' +
          '<label for="bca-salasana">Salasana</label>' +
          '<input id="bca-salasana" type="password" autocomplete="current-password" required>' +
          '<button type="submit" class="bca-nappi">Kirjaudu</button>' +
          '<p class="bca-virhe" role="alert"></p>' +
        '</form>';
      document.body.appendChild(overlay);
      var lomake = overlay.querySelector('form');
      var emailEl = overlay.querySelector('#bca-email');
      var salaEl = overlay.querySelector('#bca-salasana');
      var nappi = overlay.querySelector('.bca-nappi');
      var virhe = overlay.querySelector('.bca-virhe');
      try { emailEl.value = localStorage.getItem('bc_kirjautumis_email') || ''; } catch (e) {}
      (emailEl.value ? salaEl : emailEl).focus();

      lomake.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var email = emailEl.value.trim();
        var sala = salaEl.value;
        if (!email || !sala) { virhe.textContent = 'Anna sähköposti ja salasana.'; return; }
        virhe.textContent = '';
        nappi.disabled = true;
        nappi.textContent = 'Kirjaudutaan…';
        firebase.auth().signInWithEmailAndPassword(email, sala).then(function () {
          try { localStorage.setItem('bc_kirjautumis_email', email); } catch (e) {}
          salaEl.value = '';
        }).catch(function (e) {
          virhe.textContent = virheTeksti(e);
          nappi.disabled = false;
          nappi.textContent = 'Kirjaudu';
          salaEl.select();
        });
      });
    });
  }

  function piilotaKirjautuminen() {
    if (overlay) overlay.style.display = 'none';
  }

  function naytaUlosNappi(user) {
    kunDomValmis(function () {
      lisaaTyylit();
      if (!ulosNappi) {
        ulosNappi = document.createElement('button');
        ulosNappi.type = 'button';
        ulosNappi.className = 'bca-ulos';
        ulosNappi.addEventListener('click', function () {
          if (confirm('Kirjaudutaanko ulos?')) firebase.auth().signOut();
        });
        // Sivun yläpalkkiin, jos sille on paikka; muuten kiinteästi vasempaan alakulmaan.
        var paikka = document.querySelector('[data-bc-ulos]') || document.querySelector('.bcf-topbar-right');
        if (paikka) {
          ulosNappi.className += ' bca-upotettu';
          paikka.appendChild(ulosNappi);
        } else {
          document.body.appendChild(ulosNappi);
        }
      }
      ulosNappi.title = 'Kirjautuneena: ' + (user.email || '');
      ulosNappi.innerHTML = ulosNappi.className.indexOf('bca-upotettu') >= 0
        ? 'Kirjaudu ulos'
        : 'Kirjaudu ulos (' + esc(user.email || '') + ')';
    });
  }

  function kaynnista() {
    if (kaynnistetty) return;
    kaynnistetty = true;
    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        var ensimmainen = !kayttaja;
        kayttaja = user;
        window.bcKayttaja = user;
        piilotaKirjautuminen();
        naytaUlosNappi(user);
        if (ensimmainen) {
          var jono = odottavat;
          odottavat = [];
          jono.forEach(function (fn) {
            try { fn(user); } catch (e) { console.error(e); }
          });
        }
      } else if (kayttaja) {
        // Uloskirjautuminen (myös toisessa välilehdessä): aloitetaan puhtaalta pöydältä
        location.reload();
      } else {
        naytaKirjautuminen();
      }
    });
  }

  // Ajaa fn:n kun käyttäjä on kirjautunut (heti, jos on jo).
  window.bcKirjaudu = function (fn) {
    if (typeof fn !== 'function') fn = function () {};
    if (kayttaja) {
      setTimeout(function () { fn(kayttaja); }, 0);
    } else {
      odottavat.push(fn);
    }
    kaynnista();
  };
})();
