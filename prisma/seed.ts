import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { provisionCompany } from '../src/modules/auth/service';
import { roleNames } from '../src/config/permissions';
const db=new PrismaClient();
async function main(){
  if(process.env.NODE_ENV==='production')throw new Error('Demo seed is disabled in production.');
  const existing=await db.company.findUnique({where:{code:'DEMO'}});
  if(existing){console.log('DEMO company already exists; seed made no changes.');return;}
  const password=randomBytes(18).toString('base64url');
  const passwordHash=await bcrypt.hash(password,12);
  const names=['Aarav Sharma','Meera Kapoor','Priya Nair','Kabir Singh','Ananya Rao','Rohan Mehta','Ishaan Patel','Diya Das','Arjun Verma','Sneha Iyer','Vikram Shah'];
  await db.$transaction(async tx=>{
    const hasUsers=await tx.user.count();
    const company=await provisionCompany(tx,{code:'DEMO',name:'Demo Company Pvt Ltd',email:'hello@demo.example',timezone:'Asia/Kolkata',workingDays:[1,2,3,4,5]});
    const departments=await tx.department.findMany({where:{companyId:company.id},orderBy:{name:'asc'}});
    const designations=await tx.designation.findMany({where:{companyId:company.id},orderBy:{name:'asc'}});
    const branch=await tx.branch.findFirstOrThrow({where:{companyId:company.id}});
    for(let i=0;i<roleNames.length;i++){
      const name=roleNames[i],role=await tx.role.findUniqueOrThrow({where:{companyId_name:{companyId:company.id,name}}});
      const email=`${name.toLowerCase().replaceAll(' ','.')}@demo.example`;
      // Only the first installation may bootstrap a platform administrator.
      const user=await tx.user.create({data:{companyId:company.id,roleId:role.id,name:names[i],email,passwordHash,isSuperAdmin:name==='Super Admin'&&!hasUsers}});
      const [firstName,lastName]=names[i].split(' ');
      const joinedAt=new Date();joinedAt.setUTCMonth(joinedAt.getUTCMonth()-(i%6));joinedAt.setUTCDate(Math.min(10,joinedAt.getUTCDate()));
      await tx.employee.create({data:{companyId:company.id,userId:user.id,employeeCode:`EMP-${String(i+1).padStart(3,'0')}`,firstName,lastName,officialEmail:email,joinedAt,status:i===10?'On notice':i===8?'Probation':'Active',departmentId:departments[i%departments.length].id,designationId:designations[i%designations.length].id,branchId:branch.id}});
    }
    await tx.setupState.upsert({where:{id:1},create:{id:1},update:{}});
    await tx.auditLog.create({data:{companyId:company.id,actorName:'Development seed',action:'DEMO_CREATED',module:'company',recordId:company.id,newValue:{employeeCount:11}}});
  },{timeout:30000});
  mkdirSync('data',{recursive:true});writeFileSync('data/demo-credentials.txt',`LOCAL DEMO ACCOUNTS ONLY\nCompany code: DEMO\nPassword for demo accounts: ${password}\n\n${roleNames.map(r=>`${r}: ${r.toLowerCase().replaceAll(' ','.')}@demo.example`).join('\n')}\n`,{mode:0o600});
  console.log('Created DEMO company, 11 roles and 11 linked employees. Credentials saved to ignored data/demo-credentials.txt (not printed).');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Seed failed');process.exitCode=1;}).finally(()=>db.$disconnect());
