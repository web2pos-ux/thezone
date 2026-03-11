const fs = require('fs');
const filePath = 'c:/Users/User/Thezone/web2pos/update-server/public/dashboard/static/js/main.26ea19e0.v2.js';
let js = fs.readFileSync(filePath, 'utf8');

// Backup
fs.writeFileSync(filePath + '.pre-excel-patch', js, 'utf8');
console.log('Backup created: .pre-excel-patch');

let changes = 0;

// ============================================================
// PATCH 1: handleDownloadMenu - Replace old format with POS format
// ============================================================
// Old: 5 sheets (Menu Items, Modifiers, Taxes, Printers, Categories) with comma-separated groups
// New: 4 sheets (Menu Date, Modifiers, Taxes, Printers) with numbered columns

const oldDownload = `async()=>{G(!0);try{const e=l.map(e=>{const t=o.find(t=>t.id===e.categoryId);return{Category:(null===t||void 0===t?void 0:t.name)||"",Name:e.name,ShortName:e.shortName||"",Description:e.description||"",Price1:e.price,Price2:e.price2||0,Modifiers:Me(e.modifierGroupIds),Taxes:Fe(e.taxGroupIds),Printers:Le(e.printerGroupIds),Available:e.isAvailable?"Yes":"No"}}),r=[];d.forEach(e=>{e.modifiers.forEach(t=>{r.push({GroupName:e.name,Label:e.label||"",OptionName:t.name,Price1:t.price_adjustment,Price2:t.price_adjustment_2||0,MinSelection:e.min_selection,MaxSelection:e.max_selection})}),0===e.modifiers.length&&r.push({GroupName:e.name,Label:e.label||"",OptionName:"",Price1:0,Price2:0,MinSelection:e.min_selection,MaxSelection:e.max_selection})});const n=[];p.forEach(e=>{(e.taxes||[]).forEach(t=>{n.push({GroupName:e.name,TaxName:t.name,Rate:t.rate})}),e.taxes&&0!==e.taxes.length||n.push({GroupName:e.name,TaxName:"",Rate:0})});const a=g.map(e=>({GroupName:e.name,Type:e.type||"kitchen"})),i=o.map(e=>({Name:e.name,Description:e.description||"",Modifiers:Me(e.modifierGroupIds),Taxes:Fe(e.taxGroupIds),Printers:Le(e.printerGroupIds)})),s=lS.book_new(),c=lS.json_to_sheet(e);lS.book_append_sheet(s,c,"Menu Items");const u=lS.json_to_sheet(r);lS.book_append_sheet(s,u,"Modifiers");const h=lS.json_to_sheet(n);lS.book_append_sheet(s,h,"Taxes");const f=lS.json_to_sheet(a);lS.book_append_sheet(s,f,"Printers");const m=lS.json_to_sheet(i);lS.book_append_sheet(s,m,"Categories");Xw(s,"".concat(t.name.replace(/\\s+/g,"_"),"_menu_").concat((new Date).toISOString().split("T")[0],".xlsx")),alert("\\u2705 Excel \\ub2e4\\uc6b4\\ub85c\\ub4dc \\uc644\\ub8cc!\\n\\n\\ud83d\\udcc4 Menu Items: ".concat(l.length,"\\uac1c\\n\\ud83d\\udcc4 Modifiers: ").concat(d.length,"\\uac1c \\uadf8\\ub8f9\\n\\ud83d\\udcc4 Taxes: ").concat(p.length,"\\uac1c \\uadf8\\ub8f9\\n\\ud83d\\udcc4 Printers: ").concat(g.length,"\\uac1c \\uadf8\\ub8f9\\n\\ud83d\\udcc4 Categories: ").concat(o.length,"\\uac1c"))}catch(e){console.error("Error downloading menu:",e),alert("Failed to download menu.")}finally{G(!1)}`;

const newDownload = `async()=>{G(!0);try{const wb=lS.book_new(),menuRows=[],ibyCat={};for(const it of l){const ct=o.find(c=>c.id===it.categoryId);const cn=ct?ct.name:"Uncategorized";if(!ibyCat[cn])ibyCat[cn]=[];ibyCat[cn].push(it)}let rn=1;for(const cat of o){const cmn=[];(cat.modifierGroupIds||[]).forEach(id=>{const mg=d.find(g=>g.id===id);if(mg)cmn.push(mg.name)});const ctn=[];(cat.taxGroupIds||[]).forEach(id=>{const tg=p.find(g=>g.id===id);if(tg)ctn.push(tg.name)});const cpn=[];(cat.printerGroupIds||[]).forEach(id=>{const pg=g.find(g=>g.id===id);if(pg)cpn.push(pg.name)});const hr={No:cat.name,Category:cat.name,"Item Name":"","Short Name":"",Price:"",Price2:"",Description:""};for(let i=0;i<5;i++)hr["Modifier Group "+(i+1)]=cmn[i]||"";for(let i=0;i<3;i++)hr["Tax Group "+(i+1)]=ctn[i]||"";for(let i=0;i<3;i++)hr["Printer Group "+(i+1)]=cpn[i]||"";menuRows.push(hr);const ci=ibyCat[cat.name]||[];ci.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));for(const it of ci){const imn=[];(it.modifierGroupIds||[]).forEach(id=>{const mg=d.find(g=>g.id===id);if(mg)imn.push(mg.name)});const itn=[];(it.taxGroupIds||[]).forEach(id=>{const tg=p.find(g=>g.id===id);if(tg)itn.push(tg.name)});const ipn=[];(it.printerGroupIds||[]).forEach(id=>{const pg=g.find(g=>g.id===id);if(pg)ipn.push(pg.name)});const row={No:rn++,Category:cat.name,"Item Name":it.name,"Short Name":it.shortName||"",Price:it.price||0,Price2:it.price2||0,Description:it.description||""};for(let i=0;i<5;i++)row["Modifier Group "+(i+1)]=imn[i]||"";for(let i=0;i<3;i++)row["Tax Group "+(i+1)]=itn[i]||"";for(let i=0;i<3;i++)row["Printer Group "+(i+1)]=ipn[i]||"";menuRows.push(row)}}const ws1=lS.json_to_sheet(menuRows);lS.book_append_sheet(wb,ws1,"Menu Date");const modRows=[];for(const gr of d){const row={No:gr.id||"","Group Name":gr.name,Label:gr.label||"",Min:gr.min_selection||0,Max:gr.max_selection||0};(gr.modifiers||[]).forEach((m,i)=>{row["Modifier "+(i+1)]=m.name||"";row["Price "+(i+1)]=m.price_adjustment||0});modRows.push(row)}const ws2=lS.json_to_sheet(modRows);lS.book_append_sheet(wb,ws2,"Modifiers");const taxRows=[];for(const gr of p){const row={No:gr.id||"","Group Name":gr.name};(gr.taxes||[]).forEach((tx,i)=>{row["Tax "+(i+1)]=tx.name||"";row["Rate "+(i+1)]=tx.rate||0});taxRows.push(row)}const ws3=lS.json_to_sheet(taxRows);lS.book_append_sheet(wb,ws3,"Taxes");const prtRows=[];for(const gr of g){prtRows.push({No:gr.id||"","Group Name":gr.name,"Kitchen Type":gr.type||""})}const ws4=lS.json_to_sheet(prtRows);lS.book_append_sheet(wb,ws4,"Printers");Xw(wb,"".concat(t.name.replace(/\\s+/g,"_"),"_menu_").concat((new Date).toISOString().split("T")[0],".xlsx")),alert("Excel download complete!\\n\\nCategories: "+o.length+"\\nMenu Items: "+l.length+"\\nModifiers: "+d.length+" groups\\nTaxes: "+p.length+" groups\\nPrinters: "+g.length+" groups")}catch(e){console.error("Error downloading menu:",e),alert("Failed to download menu.")}finally{G(!1)}`;

if (js.includes(oldDownload)) {
  js = js.replace(oldDownload, newDownload);
  console.log('PATCH 1: handleDownloadMenu replaced with POS format');
  changes++;
} else {
  console.log('PATCH 1: FAILED - handleDownloadMenu pattern not found');
  // Debug
  const idx = js.indexOf('G(!0);try{const e=l.map(e=>{const t=o.find(t=>t.id===e.categoryId);return{Category:');
  console.log('  Debug - partial match at:', idx);
}

// ============================================================
// PATCH 2: handleExportToExcel - Replace old format with POS format
// ============================================================

const oldExportStart = `o.map((e,t)=>({"Sort Order":t+1,"Category Name":e.name,"Display Name (Korean)":e.displayName||e.name||"",Color:e.color||e.baseColor||"",Active:!1!==e.isActive?"Yes":"No","Item Count":l.filter(t=>t.categoryId===e.id).length})),r=l.map((e,t)=>{const r=o.find(t=>t.id===e.categoryId);return{"Sort Order":t+1,Category:(null===r||void 0===r?void 0:r.name)||"Unknown","Item Name":e.name,"Display Name (Korean)":e.displayName||e.name||"","Price 1":e.price||0,"Price 2":e.price2||0,Description:e.description||"",Active:!1!==e.isActive?"Yes":"No","Image URL":e.imageUrl||""}}),n=[];d.forEach(e=>{n.push({"Group Name":e.name,Label:e.label||"","Min Selection":e.min_selection,"Max Selection":e.max_selection,"Option Name":"","Price Adjustment 1":"","Price Adjustment 2":""}),(e.modifiers||[]).forEach(e=>{n.push({"Group Name":"",Label:"","Min Selection":"","Max Selection":"","Option Name":e.name,"Price Adjustment 1":e.price_adjustment||0,"Price Adjustment 2":e.price_adjustment_2||0})})});const a=[];p.forEach(e=>{a.push({"Group Name":e.name,"Tax Name":"","Tax Rate (%)":""}),(e.taxes||[]).forEach(e=>{a.push({"Group Name":"","Tax Name":e.name,"Tax Rate (%)":e.rate})})});const i=g.map(e=>({"Group Name":e.name,Type:e.type||"kitchen"})),s=lS.book_new(),c=lS.json_to_sheet(e);lS.book_append_sheet(s,c,"Categories");const u=lS.json_to_sheet(r);lS.book_append_sheet(s,u,"Menu Items");const h=lS.json_to_sheet(n);lS.book_append_sheet(s,h,"Modifier Groups");const f=lS.json_to_sheet(a);lS.book_append_sheet(s,f,"Tax Groups");const m=lS.json_to_sheet(i);lS.book_append_sheet(s,m,"Printer Groups")`;

const newExportBody = `(function(){const wb=lS.book_new(),menuRows=[],ibyCat={};for(const it of l){const ct=o.find(c=>c.id===it.categoryId);const cn=ct?ct.name:"Uncategorized";if(!ibyCat[cn])ibyCat[cn]=[];ibyCat[cn].push(it)}let rn=1;for(const cat of o){const cmn=[];(cat.modifierGroupIds||[]).forEach(id=>{const mg=d.find(g=>g.id===id);if(mg)cmn.push(mg.name)});const ctn=[];(cat.taxGroupIds||[]).forEach(id=>{const tg=p.find(g=>g.id===id);if(tg)ctn.push(tg.name)});const cpn=[];(cat.printerGroupIds||[]).forEach(id=>{const pg=g.find(g=>g.id===id);if(pg)cpn.push(pg.name)});const hr={No:cat.name,Category:cat.name,"Item Name":"","Short Name":"",Price:"",Price2:"",Description:""};for(let i=0;i<5;i++)hr["Modifier Group "+(i+1)]=cmn[i]||"";for(let i=0;i<3;i++)hr["Tax Group "+(i+1)]=ctn[i]||"";for(let i=0;i<3;i++)hr["Printer Group "+(i+1)]=cpn[i]||"";menuRows.push(hr);const ci=ibyCat[cat.name]||[];ci.sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));for(const it of ci){const imn=[];(it.modifierGroupIds||[]).forEach(id=>{const mg=d.find(g=>g.id===id);if(mg)imn.push(mg.name)});const itn=[];(it.taxGroupIds||[]).forEach(id=>{const tg=p.find(g=>g.id===id);if(tg)itn.push(tg.name)});const ipn=[];(it.printerGroupIds||[]).forEach(id=>{const pg=g.find(g=>g.id===id);if(pg)ipn.push(pg.name)});const row={No:rn++,Category:cat.name,"Item Name":it.name,"Short Name":it.shortName||"",Price:it.price||0,Price2:it.price2||0,Description:it.description||""};for(let i=0;i<5;i++)row["Modifier Group "+(i+1)]=imn[i]||"";for(let i=0;i<3;i++)row["Tax Group "+(i+1)]=itn[i]||"";for(let i=0;i<3;i++)row["Printer Group "+(i+1)]=ipn[i]||"";menuRows.push(row)}}const ws1=lS.json_to_sheet(menuRows);lS.book_append_sheet(wb,ws1,"Menu Date");const modRows=[];for(const gr of d){const row={No:gr.id||"","Group Name":gr.name,Label:gr.label||"",Min:gr.min_selection||0,Max:gr.max_selection||0};(gr.modifiers||[]).forEach((m,i)=>{row["Modifier "+(i+1)]=m.name||"";row["Price "+(i+1)]=m.price_adjustment||0});modRows.push(row)}const ws2=lS.json_to_sheet(modRows);lS.book_append_sheet(wb,ws2,"Modifiers");const taxRows=[];for(const gr of p){const row={No:gr.id||"","Group Name":gr.name};(gr.taxes||[]).forEach((tx,i)=>{row["Tax "+(i+1)]=tx.name||"";row["Rate "+(i+1)]=tx.rate||0});taxRows.push(row)}const ws3=lS.json_to_sheet(taxRows);lS.book_append_sheet(wb,ws3,"Taxes");const prtRows=[];for(const gr of g){prtRows.push({No:gr.id||"","Group Name":gr.name,"Kitchen Type":gr.type||""})}const ws4=lS.json_to_sheet(prtRows);lS.book_append_sheet(wb,ws4,"Printers");return wb})()`;

if (js.includes(oldExportStart)) {
  js = js.replace(oldExportStart, newExportBody);
  console.log('PATCH 2: handleExportToExcel replaced with POS format');
  changes++;
} else {
  console.log('PATCH 2: FAILED - handleExportToExcel pattern not found');
  const idx = js.indexOf('"Sort Order":t+1,"Category Name":e.name');
  console.log('  Debug - partial match at:', idx);
}

// ============================================================
// PATCH 3: handleUploadMenu - Replace old format parsing with POS format
// ============================================================
// Old: Parses Menu Items sheet with comma-separated Modifiers/Taxes/Printers columns
// New: Parses Menu Date sheet with numbered Modifier Group 1~5, Tax Group 1~3, Printer Group 1~3

const oldUploadSheets = `const a=e.Sheets["Menu Items"]||e.Sheets[r[0]],i=e.Sheets["Modifier Groups"]||e.Sheets.Modifiers,c=e.Sheets["Tax Groups"]||e.Sheets.Taxes,u=e.Sheets["Printer Groups"]||e.Sheets.Printers,h=lS.sheet_to_json(a),f=i?lS.sheet_to_json(i):[],m=c?lS.sheet_to_json(c):[],x=u?lS.sheet_to_json(u):[]`;

const newUploadSheets = `const a=e.Sheets["Menu Date"]||e.Sheets["Menu Items"]||e.Sheets[r[0]],i=e.Sheets.Modifiers||e.Sheets["Modifier Groups"],c=e.Sheets.Taxes||e.Sheets["Tax Groups"],u=e.Sheets.Printers||e.Sheets["Printer Groups"],h=lS.sheet_to_json(a),f=i?lS.sheet_to_json(i):[],m=c?lS.sheet_to_json(c):[],x=u?lS.sheet_to_json(u):[]`;

if (js.includes(oldUploadSheets)) {
  js = js.replace(oldUploadSheets, newUploadSheets);
  console.log('PATCH 3a: Upload sheet names updated (Menu Date priority)');
  changes++;
} else {
  console.log('PATCH 3a: FAILED - Upload sheet names pattern not found');
}

// PATCH 3b: Replace modifier group parsing (old vertical format -> new horizontal POS format)
const oldModParsing = `const S=new Map;for(const t of f){const e=String(t.GroupName||t["Group Name"]||""),r=String(t.Label||""),n=String(t.OptionName||t["Option Name"]||""),a=parseFloat(t.Price1||t["Price Adjustment 1"]||t.PriceAdjustment||t["Price Adjustment"]||0),o=parseFloat(t.Price2||t["Price Adjustment 2"]||0),i=parseInt(t.MinSelection||t["Min Selection"]||0),s=parseInt(t.MaxSelection||t["Max Selection"]||0);if(!e)continue;const l="".concat(e,"|||").concat(r);S.has(l)||S.set(l,{name:e,label:r,min:i,max:s,modifiers:[]}),n&&S.get(l).modifiers.push({name:n,price_adjustment:a,price_adjustment_2:o})}`;

const newModParsing = `const S=new Map;for(const t of f){const e=String(t["Group Name"]||t.GroupName||"").trim(),r=String(t.Label||"").trim(),i=parseInt(t.Min||t.MinSelection||t["Min Selection"]||0)||0,c=parseInt(t.Max||t.MaxSelection||t["Max Selection"]||0)||0;if(!e)continue;const mods=[];for(let idx=1;idx<=50;idx++){const mn=String(t["Modifier "+idx]||"").trim();if(!mn)break;const mp=parseFloat(t["Price "+idx]||0)||0;mods.push({name:mn,price_adjustment:mp,price_adjustment_2:0})}if(mods.length===0){const n=String(t.OptionName||t["Option Name"]||"").trim(),a=parseFloat(t.Price1||t["Price Adjustment 1"]||t.PriceAdjustment||0)||0,o=parseFloat(t.Price2||t["Price Adjustment 2"]||0)||0;if(n)mods.push({name:n,price_adjustment:a,price_adjustment_2:o})}const l="".concat(e,"|||").concat(r);S.has(l)||S.set(l,{name:e,label:r,min:i,max:c,modifiers:[]}),mods.forEach(m=>S.get(l).modifiers.push(m))}`;

if (js.includes(oldModParsing)) {
  js = js.replace(oldModParsing, newModParsing);
  console.log('PATCH 3b: Modifier parsing updated to POS horizontal format');
  changes++;
} else {
  console.log('PATCH 3b: FAILED - Modifier parsing pattern not found');
  const idx = js.indexOf('const S=new Map;for(const t of f)');
  console.log('  Debug - partial match at:', idx);
}

// PATCH 3c: Replace tax group parsing (old vertical -> new horizontal POS format)
const oldTaxParsing = `const k=new Map;for(const t of m){const e=t.GroupName||t["Group Name"]||"",r=String(t.TaxName||t["Tax Name"]||""),n=parseFloat(t.Rate||t["Tax Rate (%)"]||0);e&&(k.has(e)||k.set(e,{name:e,taxes:[]}),r&&k.get(e).taxes.push({name:r,rate:n}))}`;

const newTaxParsing = `const k=new Map;for(const t of m){const e=String(t["Group Name"]||t.GroupName||"").trim();if(!e)continue;k.has(e)||k.set(e,{name:e,taxes:[]});let found=false;for(let idx=1;idx<=10;idx++){const tn=String(t["Tax "+idx]||"").trim();if(!tn)break;const tr=parseFloat(t["Rate "+idx]||0)||0;k.get(e).taxes.push({name:tn,rate:tr});found=true}if(!found){const r=String(t.TaxName||t["Tax Name"]||"").trim(),n=parseFloat(t.Rate||t["Tax Rate (%)"]||0)||0;if(r)k.get(e).taxes.push({name:r,rate:n})}}`;

if (js.includes(oldTaxParsing)) {
  js = js.replace(oldTaxParsing, newTaxParsing);
  console.log('PATCH 3c: Tax parsing updated to POS horizontal format');
  changes++;
} else {
  console.log('PATCH 3c: FAILED - Tax parsing pattern not found');
  const idx = js.indexOf('const k=new Map;for(const t of m)');
  console.log('  Debug - partial match at:', idx);
}

// PATCH 3d: Replace printer group parsing
const oldPrinterParsing = `for(const n of x){const e=String(n.GroupName||n["Group Name"]||""),r=String(n.Type||"kitchen")`;
const newPrinterParsing = `for(const n of x){const e=String(n["Group Name"]||n.GroupName||"").trim(),r=String(n["Kitchen Type"]||n.Type||"kitchen")`;

if (js.includes(oldPrinterParsing)) {
  js = js.replace(oldPrinterParsing, newPrinterParsing);
  console.log('PATCH 3d: Printer parsing updated');
  changes++;
} else {
  console.log('PATCH 3d: FAILED - Printer parsing pattern not found');
}

// PATCH 3e: Replace menu item parsing to support POS format numbered columns
// Old: reads Modifiers/Taxes/Printers as comma-separated strings
// New: reads Modifier Group 1~5, Tax Group 1~3, Printer Group 1~3 as numbered columns
const oldItemParsing = `const e=String(n.Category||n["Category Name"]||""),r=String(n["Item Name"]||n.Name||""),a=String(n.ShortName||n["Short Name"]||n["Display Name (Korean)"]||""),i=String(n.Description||""),s=parseFloat(n.Price1||n["Price 1"]||0),c=parseFloat(n.Price2||n["Price 2"]||0),d=String(n.Modifiers||""),u=String(n.Taxes||""),p=String(n.Printers||"")`;

const newItemParsing = `const e=String(n.Category||n["Category Name"]||""),r=String(n["Item Name"]||n.Name||""),a=String(n["Short Name"]||n.ShortName||n["Display Name (Korean)"]||""),i=String(n.Description||""),s=parseFloat(n.Price||n.Price1||n["Price 1"]||0)||0,c=parseFloat(n.Price2||n["Price 2"]||0)||0,d=(function(){const names=[];for(let idx=1;idx<=5;idx++){const v=String(n["Modifier Group "+idx]||"").trim();if(v)names.push(v)}return names.length>0?names.join(","):String(n.Modifiers||"")})(),u=(function(){const names=[];for(let idx=1;idx<=3;idx++){const v=String(n["Tax Group "+idx]||"").trim();if(v)names.push(v)}return names.length>0?names.join(","):String(n.Taxes||"")})(),p=(function(){const names=[];for(let idx=1;idx<=3;idx++){const v=String(n["Printer Group "+idx]||"").trim();if(v)names.push(v)}return names.length>0?names.join(","):String(n.Printers||"")})()`;

if (js.includes(oldItemParsing)) {
  js = js.replace(oldItemParsing, newItemParsing);
  console.log('PATCH 3e: Menu item parsing updated to support POS numbered columns');
  changes++;
} else {
  console.log('PATCH 3e: FAILED - Menu item parsing pattern not found');
  const idx = js.indexOf('d=String(n.Modifiers||"")');
  console.log('  Debug - partial match at:', idx);
}

// Write patched file
fs.writeFileSync(filePath, js, 'utf8');
console.log('\n=== Total changes: ' + changes + ' ===');
console.log('Patched file saved to:', filePath);
