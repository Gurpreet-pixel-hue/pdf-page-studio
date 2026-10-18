// ?nointro and ?fresh (Start over) never show the sequence and never load its libraries.
async function scenario() {
  const html = document.documentElement;
  check('the opening is switched off for this visit', html.classList.contains('no-intro'));
  check('the overlay is not painted', getComputedStyle(document.getElementById('intro')).display === 'none');
  check('three.js and GSAP are not even downloaded', typeof window.THREE === 'undefined' && typeof window.gsap === 'undefined');
  check('the page is not locked', document.querySelector('.app-container').inert !== true && html.style.overflow === '');
}
