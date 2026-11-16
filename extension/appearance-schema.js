// Appearance field schema shared by popup, focus page, worker and the page session (no transport, no companion).
export const appearanceDefaults=Object.freeze({mode:'off',brightness:100,contrast:100,sepia:0,grayscale:0,background:'#181a1b',text:'#e8e6e3',link:'#8ab4f8',lightBackground:'#ffffff',lightText:'#202124',lightLink:'#0969da',imageMode:'preserve',imageBrightness:100,fontFamily:'serif',fontSize:18,lineHeight:1.7,contentWidth:760,focus:false,hidePageNumbers:true,pdfDpi:144});
export function validAppearance(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).length)return false;
  const enums={mode:['off','dark','light','auto'],imageMode:['preserve','dim','invert','smart'],fontFamily:['serif','sans','readable','book','modern','classic','system','mono'],pdfDpi:[96,144,192]};
  const ranges={brightness:[50,150],contrast:[50,150],sepia:[0,100],grayscale:[0,100],imageBrightness:[25,150],fontSize:[12,32],lineHeight:[1.2,2.4],contentWidth:[480,1200]};
  return Object.entries(value).every(([key,item])=>Object.hasOwn(appearanceDefaults,key)&&(enums[key]?enums[key].includes(item):ranges[key]?Number.isFinite(item)&&item>=ranges[key][0]&&item<=ranges[key][1]:['focus','hidePageNumbers'].includes(key)?typeof item==='boolean':typeof item==='string'&&/^#[0-9a-f]{6}$/i.test(item)));
}
export const cleanAppearance=value=>validAppearance(value)?{...appearanceDefaults,...value}:{...appearanceDefaults};
