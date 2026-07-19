
export const openImageLightbox = (src, messagesContainer) => {
  const allImages = Array.from(messagesContainer.querySelectorAll('.chat-inline-image, .message-image-preview'));
  let currentIndex = allImages.findIndex(img => img.src === src);
  if (currentIndex === -1) currentIndex = 0;

  const overlay = document.createElement('div');
  overlay.className = 'chat-lightbox-overlay';
  overlay.style.cssText = `
    position: absolute; inset: 0;
    background: rgba(0,0,0,0.95); z-index: 20;
    display: flex; align-items: center; justify-content: center;
    animation: chatFadeIn 0.3s ease-out;
    backdrop-filter: blur(15px);
    user-select: none;
  `;
  
  const updateImage = (index) => {
    const currentImg = allImages[index];
    if (!currentImg) return;
    
    const imgUrl = currentImg.src;
    const fileName = imgUrl.split('/').pop().split('?')[0] || 'image.webp';
    
    overlay.innerHTML = `
      <div class="lightbox-header" style="position:absolute; top:0; left:0; width:100%; padding:20px; display:flex; justify-content:flex-end; gap:15px; z-index:10;">
        <a href="${imgUrl}" download="${fileName}" class="lightbox-btn" title="Скачать" style="color:white; background:rgba(255,255,255,0.1); width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:50%; transition:0.2s;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </a>
        <button class="lightbox-btn close-btn" title="Закрыть" style="color:white; background:rgba(255,255,255,0.1); border:none; width:40px; height:40px; display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer; transition:0.2s;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      ${allImages.length > 1 ? `
        <button class="nav-btn prev-btn" style="position:absolute; left:20px; color:white; background:rgba(255,255,255,0.1); border:none; width:50px; height:50px; display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer; z-index:10;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <button class="nav-btn next-btn" style="position:absolute; right:20px; color:white; background:rgba(255,255,255,0.1); border:none; width:50px; height:50px; display:flex; align-items:center; justify-content:center; border-radius:50%; cursor:pointer; z-index:10;">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      ` : ''}

      <img src="${imgUrl}" style="max-width:90%; max-height:85%; object-fit:contain; border-radius:4px; box-shadow:0 0 50px rgba(0,0,0,0.5); animation:chatScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);">
      
      <div class="lightbox-counter" style="position:absolute; bottom:20px; color:white; font-size:14px; opacity:0.7;">
        ${index + 1} / ${allImages.length}
      </div>
    `;

    overlay.querySelector('.close-btn').onclick = close;
    const downloadBtn = overlay.querySelector('a[download]');
    if (downloadBtn) {
      downloadBtn.onclick = (e) => e.stopPropagation();
    }
    if (allImages.length > 1) {
      overlay.querySelector('.prev-btn').onclick = (e) => { e.stopPropagation(); navigate(-1); };
      overlay.querySelector('.next-btn').onclick = (e) => { e.stopPropagation(); navigate(1); };
    }
    
    overlay.querySelectorAll('.lightbox-btn, .nav-btn').forEach(btn => {
      btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.2)';
      btn.onmouseleave = () => btn.style.background = 'rgba(255,255,255,0.1)';
    });
  };

  const navigate = (step) => {
    currentIndex = (currentIndex + step + allImages.length) % allImages.length;
    updateImage(currentIndex);
  };

  let isClosed = false;
  const keyHandler = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') navigate(-1);
    if (e.key === 'ArrowRight') navigate(1);
  };
  const close = () => {
    if (isClosed) return;
    isClosed = true;
    window.removeEventListener('keydown', keyHandler);
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => overlay.remove(), 300);
  };

  overlay.onclick = (e) => { if (e.target.tagName !== 'IMG' && e.target.tagName !== 'SVG') close(); };
  window.addEventListener('keydown', keyHandler);

  updateImage(currentIndex);
  const overlayHost = messagesContainer?.closest?.('.chat-window') || messagesContainer?.getRootNode?.();
  if (!overlayHost || typeof overlayHost.appendChild !== 'function') return;
  overlayHost.appendChild(overlay);
};
