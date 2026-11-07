window.DAFEIYU_MULTIUSER = true;
(async()=>{
 const response=await fetch('/auth/me');const user=await response.json();if(!user.authenticated){location.href='/login?next=%2Fpanel';return;}
 const paths={overview:'M3 3h18v18H3z M3 9h18M9 9v12',config:'M4 7h16M4 17h16M8 4v6M16 14v6',persona:'m4 20 4-1L20 7l-3-3L5 16zM14 7l3 3',components:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',logs:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',activity:'M4 17 10 11l4 3 6-9M14 5h6v6',qqActivity:'M5 4h14v15H5zM9 8h6M9 12h6M9 16h3',memories:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87'};
 const nav=document.querySelector('.sidebar nav');
 for(const button of nav?.querySelectorAll('[data-page]')||[]){const text=button.querySelector('span')?.textContent||button.textContent.trim();button.replaceChildren();const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('class','nav-icon');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',paths[button.dataset.page]||paths.overview);svg.append(shape);const label=document.createElement('span');label.textContent=text;button.append(svg,label);}
 const link=document.createElement('a');link.className='nav';link.href='/account';link.textContent='← 返回工作空间';nav?.prepend(link);
 const mark=document.querySelector('.whale');if(mark){const img=document.createElement('img');img.src='/fish.svg';img.alt='';mark.replaceChildren(img);}
 const note=document.querySelector('.local-note');if(note){const address=document.getElementById('address')||document.createElement('small');address.id='address';address.textContent=location.host;const label=document.createElement('span');label.textContent=`账号：${user.username}`;note.replaceChildren(label,address);}
 document.querySelector('.brand')?.setAttribute('href','/account');const brandNote=document.querySelector('.brand small');if(brandNote)brandNote.textContent='运行控制室';
 const noteText=document.querySelector('#config .section-heading p');if(noteText)noteText.textContent='保存后重启大肥鱼生效。密钥和平台登录在账号设置中管理。';
})();
