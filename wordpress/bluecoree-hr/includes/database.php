<?php
defined('ABSPATH') || exit;

function bluecoree_hr_table(string $name): string {
    global $wpdb;
    $names = ['companies', 'employees', 'attendance', 'samples', 'audit'];
    if (!in_array($name, $names, true)) throw new InvalidArgumentException('Unknown table.');
    return $wpdb->prefix . 'bluecoree_' . $name;
}

function bluecoree_hr_install(): void {
    global $wpdb;
    if (is_multisite()) wp_die('Use a single-site WordPress installation for this release.');
    if (PHP_VERSION_ID < 80200 || !function_exists('openssl_encrypt')) wp_die('BlueCoreeHR requires PHP 8.2+ and OpenSSL.');
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $charset = $wpdb->get_charset_collate();
    $companies = bluecoree_hr_table('companies');
    $employees = bluecoree_hr_table('employees');
    $attendance = bluecoree_hr_table('attendance');
    $samples = bluecoree_hr_table('samples');
    $audit = bluecoree_hr_table('audit');
    dbDelta("CREATE TABLE $companies (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        code varchar(64) NOT NULL,
        name varchar(191) NOT NULL,
        plan varchar(16) NOT NULL DEFAULT 'BASIC',
        status varchar(16) NOT NULL DEFAULT 'ACTIVE',
        timezone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
        created_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY code (code)
    ) ENGINE=InnoDB $charset;");
    dbDelta("CREATE TABLE $employees (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        company_id bigint(20) unsigned NOT NULL,
        user_id bigint(20) unsigned NOT NULL,
        employee_code varchar(64) NOT NULL,
        designation varchar(191) NOT NULL DEFAULT '',
        department varchar(191) NOT NULL DEFAULT '',
        active tinyint(1) NOT NULL DEFAULT 1,
        face_template longtext NULL,
        consent_at datetime NULL,
        failures int(11) NOT NULL DEFAULT 0,
        locked_until datetime NULL,
        created_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY user_id (user_id),
        UNIQUE KEY company_employee (company_id,employee_code),
        KEY company_id (company_id)
    ) ENGINE=InnoDB $charset;");
    dbDelta("CREATE TABLE $attendance (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        company_id bigint(20) unsigned NOT NULL,
        employee_id bigint(20) unsigned NOT NULL,
        work_date date NOT NULL,
        check_in datetime NOT NULL,
        check_out datetime NULL,
        last_punch datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY employee_day (employee_id,work_date),
        KEY company_date (company_id,work_date)
    ) ENGINE=InnoDB $charset;");
    dbDelta("CREATE TABLE $samples (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        employee_id bigint(20) unsigned NOT NULL,
        sample_hash char(64) NOT NULL,
        created_at datetime NOT NULL,
        PRIMARY KEY  (id),
        UNIQUE KEY employee_sample (employee_id,sample_hash)
    ) ENGINE=InnoDB $charset;");
    dbDelta("CREATE TABLE $audit (
        id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
        company_id bigint(20) unsigned NOT NULL,
        user_id bigint(20) unsigned NOT NULL,
        action varchar(64) NOT NULL,
        entity_id bigint(20) unsigned NOT NULL,
        created_at datetime NOT NULL,
        PRIMARY KEY  (id),
        KEY company_date (company_id,created_at)
    ) ENGINE=InnoDB $charset;");
    foreach (['companies', 'employees', 'attendance', 'samples', 'audit'] as $name) {
        if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $wpdb->esc_like(bluecoree_hr_table($name)))) !== bluecoree_hr_table($name)) {
            wp_die('Could not create HRMS database tables. Check database permissions.');
        }
        $engine = $wpdb->get_row($wpdb->prepare('SHOW TABLE STATUS WHERE Name=%s', bluecoree_hr_table($name)), ARRAY_A);
        if (!$engine || strtoupper($engine['Engine']) !== 'INNODB') wp_die('BlueCoreeHR requires InnoDB tables for transactional attendance.');
    }
    add_role('bluecoree_employee', 'BlueCoree Employee', ['read' => true]);
    update_option('bluecoree_hr_schema_version', '0.1.0', false);
    if (!get_option('bluecoree_hr_portal_page')) {
        $id = wp_insert_post(['post_title' => 'Employee portal', 'post_name' => 'employee-portal', 'post_content' => '[bluecoree_hr]', 'post_status' => 'publish', 'post_type' => 'page'], true);
        if (!is_wp_error($id)) update_option('bluecoree_hr_portal_page', $id, false);
    }
}

function bluecoree_hr_audit(int $company, string $action, int $entity): bool {
    global $wpdb;
    return false !== $wpdb->insert(bluecoree_hr_table('audit'), [
        'company_id' => $company, 'user_id' => get_current_user_id(), 'action' => $action,
        'entity_id' => $entity, 'created_at' => gmdate('Y-m-d H:i:s'),
    ]);
}
