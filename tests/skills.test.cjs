const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..'),directory=path.join(root,'.github','skills');
const expected=[
  'homeplanner-airflow-modeling','homeplanner-architecture','homeplanner-daylight-modeling',
  'homeplanner-drawing-exports','homeplanner-electrical-modeling','homeplanner-ergonomics',
  'homeplanner-plumbing-drainage','homeplanner-project-integrity','homeplanner-site-regulations',
  'homeplanner-solar-shading','homeplanner-structural-engineering','homeplanner-thermal-modeling'
];
const sections=['When to use','Repository anchors','Required inputs','Workflow','Do not do','Validation','Output contract','References'];
const read=file=>fs.readFileSync(file,'utf8');
function localLinks(file){
  return [...read(file).matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map(match=>match[1]).filter(link=>!/^https?:|^#|^mailto:/i.test(link));
}

test('the repository has all requested specialist skill packages',()=>{
  assert.ok(fs.existsSync(directory));
  const actual=fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory())
    .map(entry=>entry.name).sort();
  assert.deepEqual(actual,expected.slice().sort());
});

for(const name of expected){
  test(`${name} has valid scoped metadata, actionable guidance and source references`,()=>{
    const folder=path.join(directory,name),file=path.join(folder,'SKILL.md'),body=read(file);
    const front=body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert.ok(front,'SKILL.md must start with YAML frontmatter');
    const lines=front[1].split(/\r?\n/);
    assert.equal(lines.length,2,'Use only name and description; no implicit tool grants');
    const declared=lines.find(line=>line.startsWith('name: '))?.slice(6);
    assert.equal(declared,name);
    assert.match(name,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(name.length<=64);
    const descriptionLine=lines.find(line=>line.startsWith('description: '));
    assert.ok(descriptionLine,'A description is required');
    const description=JSON.parse(descriptionLine.slice(13));
    assert.equal(typeof description,'string');
    assert.ok(description.length>=80&&description.length<=1024);
    assert.match(description,/use|when/i,'Describe activation, not only a generic persona');
    assert.ok(body.split(/\r?\n/).length<500);
    for(const section of sections)assert.ok(body.includes(`## ${section}`),`Missing ${section}`);
    assert.match(body,/node --test/,'Reference the repository validation workflow');
    assert.ok(localLinks(file).some(link=>link.replaceAll('\\','/')==='references/sources.md'));
    const links=localLinks(file).map(link=>link.replaceAll('\\','/').replace(/^\.\//,''));
    for(const required of ['references/calculations.md','references/python-tools.md','scripts/example.py'])
      assert.ok(links.includes(required),`Missing calculation/example link: ${required}`);
    for(const reference of ['calculations.md','python-tools.md']){
      const content=read(path.join(folder,'references',reference));
      assert.match(content,/https:\/\//,`${reference} needs primary/documentation references`);
      assert.match(content,/example|worked|synthetic/i,`${reference} must identify reference examples`);
    }
    const example=read(path.join(folder,'scripts','example.py'));
    assert.match(example,/--check/,'The standalone example needs an explicit validation path');
    assert.match(body,/example\.py --check/,'Document the executable numerical checks');
    const sources=read(path.join(folder,'references','sources.md'));
    assert.ok((sources.match(/https:\/\//g)||[]).length>=2,'Include at least two primary source links');
    assert.match(sources,/2026-09-17|17 September 2026|17 Sep 2026/i,'Record when sources were checked');
    assert.doesNotMatch(front[1],/allowed-tools|license:|author:/);
  });
}

test('skill links stay within the repository and resolve to existing files',()=>{
  const files=[path.join(directory,'README.md'),path.join(root,'AGENTS.md'),
    path.join(root,'.github','copilot-instructions.md'),
    ...expected.flatMap(name=>[path.join(directory,name,'SKILL.md'),
      ...fs.readdirSync(path.join(directory,name,'references')).filter(file=>file.endsWith('.md'))
        .map(file=>path.join(directory,name,'references',file))])];
  for(const file of files){
    for(const link of localLinks(file)){
      const target=path.resolve(path.dirname(file),decodeURIComponent(link.split('#')[0]).replaceAll('/',path.sep));
      assert.ok(target===root||target.startsWith(root+path.sep),`Link leaves repository: ${file} -> ${link}`);
      assert.ok(fs.existsSync(target),`Missing target: ${file} -> ${link}`);
    }
  }
});

test('the catalogue routes calculations through existing research and an offline validator',()=>{
  const catalogue=read(path.join(directory,'README.md'));
  assert.match(catalogue,/docs\/research\/building-performance\.md/);
  assert.match(catalogue,/docs\/research\/building-analysis-toolchain\.md/);
  assert.match(catalogue,/validate_skill_examples\.py/);
  assert.ok(fs.existsSync(path.join(root,'tests','validate_skill_examples.py')));
});

test('documented test selectors exist and specialist routing names the whole catalogue',()=>{
  const guidance=read(path.join(root,'AGENTS.md')),catalogue=read(path.join(directory,'README.md'));
  for(const name of expected){
    assert.ok(guidance.includes(name),`Missing routing for ${name}`);
    assert.ok(catalogue.includes(name),`Missing catalogue entry for ${name}`);
    const body=read(path.join(directory,name,'SKILL.md'));
    for(const match of body.matchAll(/tests[\\/][A-Za-z0-9._-]+\.test\.cjs/g)){
      const selector=match[0].replace(/[\\/]/g,path.sep);
      assert.ok(fs.existsSync(path.join(root,selector)),`Unknown test selector ${selector}`);
    }
  }
});
