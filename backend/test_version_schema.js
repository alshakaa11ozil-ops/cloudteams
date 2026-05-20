const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    try {
        console.log('Fetching first file...');
        const file = await prisma.file.findFirst();
        if (!file) {
            console.log('No files found to test with.');
            return;
        }
        console.log(`Found file ID ${file.id}. Attempting to save version...`);
        
        const version = await prisma.fileVersion.create({
            data: {
                file_id: file.id,
                version_number: 999,
                storage_path: 'test_path',
                file_size: 123,
                uploaded_by: file.uploaded_by,
                version_name: 'Test Version',
                encryption_iv: '0123456789abcdef0123456789abcdef'
            }
        });
        
        console.log('✅ Version saved successfully:', version);
        
        console.log('Cleaning up...');
        await prisma.fileVersion.delete({ where: { id: version.id } });
        console.log('✅ Cleanup complete.');
    } catch (err) {
        console.error('❌ Test failed:', err);
    } finally {
        await prisma.$disconnect();
    }
}

test();
