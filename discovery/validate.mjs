export function validate(m, expected){
 const keys=['protocol','version','project','name','description','publicPage','source','intendedUseCases','limitations','publicationStatus','productionStatus','verifiedCapabilities','publicEvidence'];
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).length!==keys.length||keys.some(k=>!Object.hasOwn(m,k)))throw Error('Invalid manifest fields');
 if(m.protocol!=='JSC-ADRP'||m.version!=='1.0.0-draft'||m.project!==expected.project||m.name!==expected.name||m.description!==expected.description||m.publicPage!==expected.publicPage||m.source!==expected.source||JSON.stringify(m.intendedUseCases)!==JSON.stringify(expected.intendedUseCases)||JSON.stringify(m.limitations)!==JSON.stringify(expected.limitations))throw Error('Identity or positioning drift');
 if(m.publicationStatus!=='draft'||m.productionStatus!=='UNKNOWN'||!Array.isArray(m.verifiedCapabilities)||m.verifiedCapabilities.length||!Array.isArray(m.publicEvidence)||m.publicEvidence.length)throw Error('Unverified publication or capability');
 return true;
}
export function graph(m,expected){
 validate(m,expected);
 const org={'@type':'Organization','@id':'https://www.jussco.company/#organization',name:'Juss & Co',url:'https://www.jussco.company/'};
 const product={'@type':'SoftwareApplication','@id':m.source.split('/blob/')[0]+'#application',name:m.name,description:m.description,publisher:{'@id':org['@id']}};
 if(m.publicPage)product.url=m.publicPage;
 return {'@context':'https://schema.org','@graph':[org,product]};
}
