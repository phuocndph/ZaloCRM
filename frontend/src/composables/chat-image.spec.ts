import {describe,it,expect} from 'vitest';
import {chatImageUrls,chatImageUrl} from './chat-image';
describe('shared chat image recognition',()=>{
  it('keeps original, standard and thumbnail sources in the same order for chat and albums',()=>{
    expect(chatImageUrls({contentType:'image',content:JSON.stringify({hdUrl:'https://cdn.test/hd.jpg',oriUrl:'https://cdn.test/original.jpg',href:'/files/stored.webp',thumbUrl:'/files/thumb.webp'})})).toEqual(['https://cdn.test/hd.jpg','https://cdn.test/original.jpg','/files/stored.webp','/files/thumb.webp']);
  });
  it.each(['link','video','file','sticker','voice','audio','call','reminder','contact_card'])('never uses a %s thumbnail as an image message',contentType=>{
    expect(chatImageUrls({contentType,content:JSON.stringify({href:'https://photo.zdn.vn/thumb.jpg'})})).toEqual([]);
  });
  it('keeps a plain text image link as text',()=>{expect(chatImageUrls({contentType:'text',content:'https://files.test/photo.jpg'})).toEqual([]);});
  it('accepts legacy images with object params but excludes document attachments',()=>{
    expect(chatImageUrl({content:JSON.stringify({href:'https://photo.zdn.vn/id',params:{fileExt:'jpg'}})})).toBe('https://photo.zdn.vn/id');
    expect(chatImageUrls({content:JSON.stringify({href:'https://photo.zdn.vn/id',params:{fileExt:'pdf'},thumb:'/thumb.jpg'})})).toEqual([]);
  });
  it.each(['javascript:alert(1)','//outside.test/photo.jpg','https://name:secret@host.test/photo.jpg','{bad json','null'])('ignores malformed and unsupported sources: %s',content=>{
    expect(chatImageUrls({contentType:'image',content})).toEqual([]);
  });
});
