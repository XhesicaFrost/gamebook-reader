import fs from "node:fs";
import path from "node:path";

const buildDir = "/private/tmp/gamebook-sample-build";
fs.mkdirSync(buildDir, { recursive: true });

const pages = [
  {
    kind: "cover",
    kicker: "一本用于测试“岔路书签”的微型冒险",
    title: ["雾林中的", "钟塔"],
    subtitle: "扫描版功能示例",
    footer: "本故事及版面均为原创演示内容"
  },
  {
    kind: "rules",
    number: "使用说明",
    title: "冒险规则",
    paragraphs: [
      "你在暮色中醒来，手中只有一盏旧提灯。按照每页末尾的选择，前往指定页码。",
      "这份 PDF 的前两页是封面和说明，因此书中页码与 PDF 实际页码相差 2 页。",
      "在“岔路书签”中把页码偏移设为 2，再导入附带的示例书签数据，即可直接点击路线。"
    ],
    note: "目标：找到雾林钟塔，并让沉默的钟再次响起。"
  },
  {
    kind: "story",
    number: "1",
    title: "雾林入口",
    paragraphs: [
      "冷雾贴着地面流动。你站在一块倾斜的路牌前，两条小径伸入幽暗树林。",
      "左侧路上有微弱灯火，右侧则立着一块布满青苔的石碑。远处传来一声似有若无的钟鸣。"
    ],
    choices: [
      ["沿着灯火前进", "转到第 3 页"],
      ["检查古老石碑", "转到第 5 页"]
    ],
    art: "forest"
  },
  {
    kind: "story",
    number: "2",
    title: "生锈的铁门",
    paragraphs: [
      "铁门后是一条通往钟塔的近路，但锁孔中塞满红褐色铁锈。门上刻着一句话：",
      "“让听不见钟声的人，带着石头的记忆归来。”你觉得某种符号或许能打开它。"
    ],
    choices: [
      ["如果记录了“月纹”，尝试开门", "转到第 6 页"],
      ["暂时离开，寻找别的道路", "转到第 4 页"]
    ],
    art: "gate"
  },
  {
    kind: "story",
    number: "3",
    title: "守林人的小屋",
    paragraphs: [
      "木屋的窗里亮着一盏油灯，屋内却空无一人。桌上放着一把铜钥匙和一张残破地图。",
      "地图显示，钟塔前的铁门能被钥匙打开；河上的旧桥则通向塔的背面。"
    ],
    choices: [
      ["带走铜钥匙，寻找铁门", "转到第 2 页"],
      ["按照地图寻找旧桥", "转到第 4 页"]
    ],
    art: "cabin"
  },
  {
    kind: "story",
    number: "4",
    title: "断裂的木桥",
    paragraphs: [
      "黑色河水在脚下翻涌。桥板缺了三块，绳索也在风中呻吟。对岸已经能看见钟塔的轮廓。",
      "桥边挂着守林人的警告：不要在钟声停止时回头。"
    ],
    choices: [
      ["抓住绳索，小心通过", "转到第 6 页"],
      ["觉得太危险，返回林口", "转到第 1 页"]
    ],
    art: "bridge"
  },
  {
    kind: "story",
    number: "5",
    title: "月纹石碑",
    paragraphs: [
      "你拂去青苔，露出一道银白色月牙。指尖触碰石面时，纹路短暂发亮。",
      "请在工具中把本节点标记为“线索”，并在备注中写下：获得月纹。"
    ],
    choices: [
      ["追随林间灯火", "转到第 3 页"],
      ["寻找刻有相同月纹的铁门", "转到第 2 页"]
    ],
    art: "stone"
  },
  {
    kind: "story",
    number: "6",
    title: "沉默钟塔",
    paragraphs: [
      "你终于抵达塔顶。巨钟下方悬着一根褪色绳索，月光从破碎的穹顶落下。",
      "你用力拉动绳索。钟声穿过雾林，所有小路同时亮起金色灯火——冒险完成。"
    ],
    choices: [
      ["重新开始，探索另一条路线", "转到第 1 页"]
    ],
    art: "tower"
  }
];

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

function textLines(lines, x, y, size, gap, extra = "") {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * gap}" font-size="${size}" ${extra}>${escapeXml(line)}</text>`).join("\n");
}

function art(type) {
  const common = `fill="none" stroke="#385447" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".82"`;
  if (type === "tower") return `<g ${common}><path d="M510 476h180l-18-182H528z"/><path d="m518 294 82-92 82 92M558 476v-92h84v92M568 330h64M600 202v-36M575 166h50"/><circle cx="600" cy="334" r="25"/></g>`;
  if (type === "cabin") return `<g ${common}><path d="m485 330 115-90 115 90M510 314v155h180V314M576 469v-88h48v88M535 347h42v42h-42M644 347h22v42h-22"/><path d="M690 270v-62h-34v35"/></g>`;
  if (type === "bridge") return `<g ${common}><path d="M420 408c100-82 260-82 360 0M432 430c90-58 246-58 336 0M460 384l-18 100M740 384l18 100"/><path d="m492 387-8 64m65-84-3 61m54-69v65m54-57 3 61m54-41 8 64"/></g>`;
  if (type === "stone") return `<g ${common}><path d="m531 467 18-204 51-58 51 58 18 204z"/><path d="M628 285a54 54 0 1 0 0 91 63 63 0 1 1 0-91Z"/></g>`;
  if (type === "gate") return `<g ${common}><path d="M475 478V308c0-85 56-130 125-130s125 45 125 130v170M520 478V315c0-54 36-91 80-91s80 37 80 91v163"/><path d="M600 224v254M520 342h160"/><circle cx="625" cy="387" r="9"/></g>`;
  return `<g ${common}><path d="M455 470c28-115 70-195 130-252M525 470c-5-92 14-184 58-276M690 470c-26-107-65-185-116-241M744 470c-10-90-48-162-103-226"/><path d="M467 373c-54-12-78-42-94-82 56-4 86 21 105 56M554 311c-52-18-72-50-83-92 55 3 81 30 95 67M690 338c54-20 83-53 96-94-56 2-84 29-100 65"/></g>`;
}

function storyArt(type) {
  return `<g transform="translate(120 125) scale(.8)">${art(type)}</g>`;
}

function baseSvg(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
    <defs>
      <filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="8"/><feColorMatrix values="0 0 0 0 .45 0 0 0 0 .38 0 0 0 0 .25 0 0 0 .08 0"/></filter>
      <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1200" height="1200" fill="#efe5cf"/>
    <rect width="1200" height="1200" filter="url(#paper)" opacity=".42"/>
    <rect x="196" y="30" width="808" height="1140" rx="4" fill="none" stroke="#725f3d" stroke-width="2" opacity=".65"/>
    <rect x="209" y="43" width="782" height="1114" rx="2" fill="none" stroke="#725f3d" stroke-width="1" opacity=".35"/>
    <g font-family="Songti SC, STSong, PingFang SC, serif" fill="#29261f">${content}</g>
  </svg>`;
}

function renderPage(page, index) {
  if (page.kind === "cover") {
    return baseSvg(`
      <circle cx="600" cy="386" r="205" fill="#d8c9a8" opacity=".65"/>
      <circle cx="600" cy="386" r="175" fill="none" stroke="#385447" stroke-width="3"/>
      ${art("tower")}
      <text x="600" y="105" text-anchor="middle" font-size="20" letter-spacing="3" fill="#596b5f">${escapeXml(page.kicker)}</text>
      ${textLines(page.title, 600, 700, 80, 90, `text-anchor="middle" font-weight="700"`)}
      <path d="M430 875h340" stroke="#8a7145" stroke-width="2"/>
      <text x="600" y="930" text-anchor="middle" font-size="28" letter-spacing="8" fill="#385447">${escapeXml(page.subtitle)}</text>
      <text x="600" y="1102" text-anchor="middle" font-size="16" fill="#6f685a">${escapeXml(page.footer)}</text>
    `);
  }

  if (page.kind === "rules") {
    const paragraphs = page.paragraphs.map((paragraph, i) => `<text x="270" y="${320 + i * 170}" font-size="26"><tspan x="270" dy="0">${escapeXml(paragraph.slice(0, 25))}</tspan><tspan x="270" dy="44">${escapeXml(paragraph.slice(25))}</tspan></text>`).join("\n");
    return baseSvg(`
      <text x="600" y="105" text-anchor="middle" font-size="17" letter-spacing="4" fill="#6f685a">雾林中的钟塔 · 功能示例</text>
      <text x="600" y="220" text-anchor="middle" font-size="54" font-weight="700">${escapeXml(page.title)}</text>
      <path d="M465 255h270" stroke="#8a7145" stroke-width="2"/>
      ${paragraphs}
      <rect x="255" y="855" width="690" height="135" rx="12" fill="#dce5d9" stroke="#647b6d" stroke-width="2"/>
      <text x="600" y="913" text-anchor="middle" font-size="20" fill="#385447" font-weight="700">冒险目标</text>
      <text x="600" y="955" text-anchor="middle" font-size="24">${escapeXml(page.note)}</text>
      <text x="600" y="1110" text-anchor="middle" font-size="16" fill="#756e60">PDF 第 ${index + 1} 页 · 本页不计入书中页码</text>
    `);
  }

  const paragraphs = page.paragraphs.map((paragraph, i) => {
    const splitAt = 24;
    return `<text x="270" y="${570 + i * 115}" font-size="25"><tspan x="270">${escapeXml(paragraph.slice(0, splitAt))}</tspan><tspan x="270" dy="42">${escapeXml(paragraph.slice(splitAt))}</tspan></text>`;
  }).join("\n");
  const choices = page.choices.map((choice, i) => {
    const y = 835 + i * 104;
    return `<g><rect x="260" y="${y}" width="680" height="80" rx="10" fill="#f7f0df" stroke="#8a7145" stroke-width="2"/><circle cx="300" cy="${y + 40}" r="17" fill="#385447"/><text x="300" y="${y + 47}" text-anchor="middle" font-size="20" fill="#fff">${String.fromCharCode(65 + i)}</text><text x="335" y="${y + 34}" font-size="22" font-weight="700">${escapeXml(choice[0])}</text><text x="335" y="${y + 62}" font-size="17" fill="#6b6253">${escapeXml(choice[1])}</text></g>`;
  }).join("\n");
  return baseSvg(`
    <text x="600" y="92" text-anchor="middle" font-size="17" letter-spacing="4" fill="#6f685a">雾林中的钟塔</text>
    <circle cx="600" cy="164" r="42" fill="#385447"/>
    <text x="600" y="178" text-anchor="middle" font-size="38" fill="#fff" font-weight="700">${escapeXml(page.number)}</text>
    <text x="600" y="255" text-anchor="middle" font-size="49" font-weight="700">${escapeXml(page.title)}</text>
    <path d="M510 282h180" stroke="#8a7145" stroke-width="2"/>
    ${storyArt(page.art)}
    ${paragraphs}
    ${choices}
    <text x="600" y="1120" text-anchor="middle" font-size="16" fill="#756e60">— ${escapeXml(page.number)} —</text>
  `);
}

pages.forEach((page, index) => {
  const filename = `page-${String(index + 1).padStart(2, "0")}.svg`;
  fs.writeFileSync(path.join(buildDir, filename), renderPage(page, index), "utf8");
});

console.log(`generated ${pages.length} SVG pages in ${buildDir}`);
