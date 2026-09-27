// 404 page. paths.root is absolute here ('/' or siteUrl + '/') because the host serves it at any URL.
// Everything is above the fold, so nothing here waits for the scroll reveal (main.js).
import { attrs } from './util.mjs';
import { icons, vectorscope } from './icons.mjs';
import { documentShell } from './layout.mjs';

export function render404(vm) {
  const root = vm.paths?.root ?? '/';
  const main = `<section class="notfound" aria-labelledby="notfound-title">
  <div class="notfound__graphic" aria-hidden="true">${vectorscope('empty', 'notfound__scope')}</div>
  <div class="container notfound__inner">
    <p class="notfound__code label" lang="en"><span class="notfound__dot" aria-hidden="true"></span>ERROR 404 · NO SIGNAL</p>
    <h1 class="notfound__title" id="notfound-title">페이지를 찾을 수 없습니다</h1>
    <p class="notfound__lead">주소가 바뀌었거나 더 이상 공개되지 않는 페이지입니다. 아래 링크에서 작업을 둘러보시거나 바로 문의해 주세요.</p>
    <div class="notfound__actions">
      <a class="button button--primary"${attrs({ href: root || './' })}>홈으로${icons.arrowRight()}</a>
      <a class="button button--ghost"${attrs({ href: `${root}#works` })}>작업 보기</a>
      <a class="button button--ghost"${attrs({ href: `${root}#contact` })}>문의하기</a>
    </div>
  </div>
</section>`;
  return documentShell(vm, { page: '404', main });
}
