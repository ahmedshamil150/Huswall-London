import { bootStaticPage } from '/shared/js/page-boot.js';

bootStaticPage().catch((error) => console.error('[page]', error));
