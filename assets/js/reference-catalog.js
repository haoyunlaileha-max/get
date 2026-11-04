(()=>{"use strict";
const vpsRegions=[
["冰岛","IS","7643/9454",[10,16,23,32,44,58.5]],
["巴拿马","PA","7443P/9254",[8.5,13.5,19.5,27,36.5,49]],
["摩尔多瓦","MD","7313P/9124",[7.5,12,17,24.5,34.5,44]],
["罗马尼亚","RO","7443P/9254",[8.5,13.5,19.5,27,36.5,49]],
["瑞士","CH","75F3/9474F",[11,17,24.5,34.5,46.5,58.5]],
["荷兰","NL","7543/9354",[9,14.5,21,29.5,39,54]],
["俄罗斯","RU","7313P/9124",[7.5,12,17,24.5,34.5,44]]
];
const vpsSpecs=[
["2 vCPU","4 GB DDR4","60 GB NVMe","无限","1 Gbps"],
["4 vCPU","8 GB DDR4","120 GB NVMe","无限","1 Gbps"],
["6 vCPU","16 GB DDR4","200 GB NVMe","无限","1 Gbps"],
["8 vCPU","32 GB DDR5","400 GB NVMe","无限","1 Gbps"],
["12 vCPU","48 GB DDR5","600 GB NVMe","无限","2 Gbps"],
["16 vCPU","64 GB DDR5","1 TB NVMe","无限","2 Gbps"]];
const dedicatedRegions=[
["冰岛","IS",[63,112,185.5,279]],["巴拿马","PA",[53.5,97.5,161,244.5]],
["瑞士","CH",[68,122,195.5,293.5]],["荷兰","NL",[58.5,102.5,171,259]],
["俄罗斯","RU",[48.5,87.5,146.5,220]]
];
const dedicatedSpecs=[
["8C/16T Xeon E-2388G 3.2GHz","64 GB DDR4 ECC","2×1 TB NVMe","2 Gbps"],
["16C/32T Ryzen 9 7950X 4.5GHz","128 GB DDR5","2×2 TB NVMe","5 Gbps"],
["32C/64T EPYC 9354 3.25GHz","128 GB DDR5 ECC","4×2 TB NVMe","10 Gbps"],
["64C/128T 2× EPYC 9354","256 GB DDR5 ECC","4×4 TB NVMe","10 Gbps"]];
const gpuRegions=[
["冰岛","IS",[146.5,234.5,906,1714.5]],["摩尔多瓦","MD",[122,195.5,832.5,1567.5]],
["罗马尼亚","RO",[132,210,857,1616.5]],["荷兰","NL",[136.5,220,881.5,1665.5]]
];
const gpuSpecs=[
["1× RTX 4090","24 GB GDDR6X","12 vCPU","64 GB DDR5","1 TB NVMe"],
["1× RTX 5090","32 GB GDDR7","16 vCPU","96 GB DDR5","1.5 TB NVMe"],
["1× H100 SXM5","80 GB HBM3","24 vCPU","192 GB DDR5","2 TB NVMe"],
["2× H100 SXM5","160 GB HBM3","32 vCPU","384 GB DDR5","4 TB NVMe"]];
const rdpPlans=[
["MD-S","2 vCPU Ryzen 7 5800X 4.7GHz","4 GB DDR4","60 GB NVMe","2 TB/月","1 Gbps",11],
["MD-M","4 vCPU Ryzen 7 5800X 4.7GHz","8 GB DDR4","120 GB NVMe","5 TB/月","1 Gbps",16],
["MD-L","6 vCPU Ryzen 7 5800X 4.7GHz","16 GB DDR4","200 GB NVMe","10 TB/月","1 Gbps",22],
["MD-XL","8 vCPU Ryzen 7 7700X 5.4GHz","32 GB DDR5","400 GB NVMe","20 TB/月","2 Gbps",32]
];
const money=n=>"$"+Number(n).toFixed(2)+"/月";
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function table(title,headers,rows){return '<section class="reference-region"><h3>'+esc(title)+'</h3><div class="reference-scroll"><table class="reference-table"><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></section>';}
function render(){
const root=document.getElementById("reference-catalog-content");if(!root)return;
const type=document.body.dataset.productCategory;let html='<div class="reference-heading"><div><span class="kicker">ANONPORT PRODUCT CATALOG</span><h2>完整套餐与价格目录</h2><p>按原站公开页面整理；价格为美元/月。此处为参考目录，不代表当前供应商库存或可下单状态。</p></div><span class="reference-source">来源：anonport.com 产品公开目录</span></div>';
if(type==="vps"){
html+='<p class="reference-note">每个地区提供 S / M / L / XL / XXL / PRO 六档。AMD EPYC、KVM、NVMe；带宽不限，具体上行见表。</p>';
for(const [name,code,cpu,prices] of vpsRegions){const rows=prices.map((p,i)=>[code+"-"+["S","M","L","XL","XXL","PRO"][i],vpsSpecs[i][0]+" · EPYC "+(i<3?cpu.split("/")[0]:cpu.split("/")[1]),vpsSpecs[i][1],vpsSpecs[i][2],vpsSpecs[i][3],vpsSpecs[i][4],money(p)]);html+=table(name+" · VPS 套餐",["方案","CPU","内存","NVMe","流量","上行链路","价格"],rows);}
}
if(type==="dedicated"){html+='<p class="reference-note">公开详细套餐覆盖冰岛、巴拿马、瑞士、荷兰、俄罗斯，每地 4 档裸金属服务器。</p>';for(const [name,code,prices] of dedicatedRegions){const rows=prices.map((p,i)=>[code+"-"+(i+1),dedicatedSpecs[i][0],dedicatedSpecs[i][1],dedicatedSpecs[i][2],"不限",dedicatedSpecs[i][3],money(p)]);html+=table(name+" · 独立服务器",["方案","CPU","内存","存储","流量","上行链路","价格"],rows);}}
if(type==="gpu"){html+='<p class="reference-note">GPU 公开供应地区：冰岛、摩尔多瓦、罗马尼亚、荷兰。俄罗斯、瑞士、巴拿马未列入 GPU 供应。</p>';for(const [name,code,prices] of gpuRegions){const rows=prices.map((p,i)=>[code+"-"+["S","M","L","XL"][i],gpuSpecs[i][0],gpuSpecs[i][1],gpuSpecs[i][2],gpuSpecs[i][3],gpuSpecs[i][4],"不限",money(p)]);html+=table(name+" · GPU AI 托管",["方案","GPU","显存","CPU","内存","NVMe","带宽","价格"],rows);}}
if(type==="rdp"){html+='<p class="reference-note">原站概览列出摩尔多瓦、罗马尼亚、荷兰、俄罗斯 4 个 RDP 地区。当前可核对到完整逐档规格的是摩尔多瓦；其他地区仅展示原站公开起价，不补造配置。</p>';html+=table("摩尔多瓦 · Windows RDP",["方案","CPU","内存","NVMe","流量","上行链路","价格"],rdpPlans.map(x=>[x[0],x[1],x[2],x[3],x[4],x[5],money(x[6])]));html+='<div class="reference-starts">'+[["罗马尼亚","$12.00/月起"],["荷兰","$12.00/月起"],["俄罗斯","$11.00/月起"]].map(x=>'<article><b>'+x[0]+'</b><strong>'+x[1]+'</strong><small>原站公开起价；逐档规格尚未取得可核对资料</small></article>').join('')+'</div>';}
root.innerHTML=html;
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",render);else render();
})();